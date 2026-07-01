import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireTenant } from '../middleware/tenant.js';
import { bookingLimiter } from '../middleware/rate-limit.js';
import { sendTelegram, formatNewBookingMessage } from '../lib/telegram.js';
import { validateKZPhone, validateName, validateText } from '../lib/validation.js';

const router = Router();

// Создание новой брони с сайта
// Rate limit: 5 заявок / 10 минут с одного IP+tenant
router.post('/', bookingLimiter, requireTenant, async (req, res) => {
    try {
        const { room_id, guest_name, guest_phone, guest_email, check_in, check_out, guests_count, notes, hp_field } = req.body;

        // HONEYPOT: невидимое поле, которое заполняют только боты
        if (hp_field && hp_field.length > 0) {
            console.warn('Honeypot triggered:', { ip: req.ip, tenant: req.tenant?.slug, hp_field });
            // Отвечаем как будто всё ок — бот не поймёт что раскрыт
            return res.status(201).json({ ok: true, booking: { id: 0, status: 'new' } });
        }

        // Валидация обязательных полей
        if (!room_id || !guest_name || !guest_phone || !check_in || !check_out) {
            return res.status(400).json({ error: 'missing_required_fields' });
        }

        // Валидация имени
        const nameCheck = validateName(guest_name);
        if (!nameCheck.ok) return res.status(400).json({ error: nameCheck.error });

        // Валидация телефона
        const phoneCheck = validateKZPhone(guest_phone);
        if (!phoneCheck.ok) return res.status(400).json({ error: phoneCheck.error });

        // Валидация комментария
        const notesCheck = validateText(notes, 500);
        if (!notesCheck.ok) return res.status(400).json({ error: notesCheck.error });

        // Валидация email (если передан)
        let cleanEmail = null;
        if (guest_email) {
            if (typeof guest_email !== 'string' || guest_email.length > 200 || !guest_email.includes('@')) {
                return res.status(400).json({ error: 'invalid_email' });
            }
            cleanEmail = guest_email.trim().toLowerCase();
        }

        // Валидация количества гостей
        const guestsCount = parseInt(guests_count, 10);
        if (guests_count != null && (isNaN(guestsCount) || guestsCount < 1 || guestsCount > 50)) {
            return res.status(400).json({ error: 'invalid_guests_count' });
        }

        // Валидация дат
        const checkInDate = new Date(check_in);
        const checkOutDate = new Date(check_out);
        if (isNaN(checkInDate) || isNaN(checkOutDate) || checkOutDate <= checkInDate) {
            return res.status(400).json({ error: 'invalid_dates' });
        }

        // Проверка что даты не в далёком прошлом
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (checkInDate < today) {
            return res.status(400).json({ error: 'past_dates' });
        }

        // Проверка что даты не слишком далеко в будущем (защита от абсурдных значений)
        const maxFutureDate = new Date();
        maxFutureDate.setFullYear(maxFutureDate.getFullYear() + 2);
        if (checkInDate > maxFutureDate) {
            return res.status(400).json({ error: 'dates_too_far' });
        }

        // Проверка максимальной длины пребывания (365 дней)
        const nights = Math.ceil((checkOutDate - checkInDate) / 86400000);
        if (nights > 365) {
            return res.status(400).json({ error: 'stay_too_long' });
        }

        // Транзакция для защиты от двойных броней
        await query('BEGIN');
        try {
            const roomResult = await query(
                'SELECT id, name, price_per_day FROM rooms WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE FOR UPDATE',
                [room_id, req.tenant.id]
            );
            if (roomResult.rowCount === 0) {
                await query('ROLLBACK');
                return res.status(404).json({ error: 'room_not_found' });
            }
            const room = roomResult.rows[0];

            const overlap = await query(
                `SELECT id FROM bookings
                 WHERE room_id = $1 AND status NOT IN ('cancelled', 'no_show')
                   AND check_in < $3 AND check_out > $2 LIMIT 1`,
                [room_id, check_in, check_out]
            );
            if (overlap.rowCount > 0) {
                await query('ROLLBACK');
                return res.status(409).json({ error: 'dates_unavailable' });
            }

            const total_price = nights * Number(room.price_per_day);

            const insertResult = await query(
                `INSERT INTO bookings (tenant_id, room_id, guest_name, guest_phone, guest_email,
                                       check_in, check_out, guests_count, total_price, source, notes, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'site', $10, 'new')
                 RETURNING *`,
                [req.tenant.id, room_id, nameCheck.name, phoneCheck.phone, cleanEmail,
                 check_in, check_out, guestsCount || 1, total_price, notesCheck.text]
            );

            await query('COMMIT');

            const booking = insertResult.rows[0];

            // Уведомление в Telegram (не блокируем ответ)
            const tgMessage = formatNewBookingMessage(booking, req.tenant, room);
            sendTelegram(req.tenant.telegram_chat_id, tgMessage)
                .catch(err => console.error('TG send failed (non-blocking):', err));

            res.status(201).json({
                ok: true,
                booking: {
                    id: booking.id,
                    status: booking.status,
                    total_price: booking.total_price,
                    check_in: booking.check_in,
                    check_out: booking.check_out
                }
            });
        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }
    } catch (err) {
        console.error('POST /bookings error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

export default router;
