import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireTenant } from '../middleware/tenant.js';
import { sendTelegram, formatNewBookingMessage } from '../lib/telegram.js';

const router = Router();

// Создание новой брони с сайта
router.post('/', requireTenant, async (req, res) => {
    try {
        const { room_id, guest_name, guest_phone, guest_email, check_in, check_out, guests_count, notes } = req.body;

        // Валидация
        if (!room_id || !guest_name || !guest_phone || !check_in || !check_out) {
            return res.status(400).json({ error: 'missing_required_fields' });
        }

        const checkInDate = new Date(check_in);
        const checkOutDate = new Date(check_out);
        if (isNaN(checkInDate) || isNaN(checkOutDate) || checkOutDate <= checkInDate) {
            return res.status(400).json({ error: 'invalid_dates' });
        }

        // Минимальная валидация телефона
        const phoneClean = String(guest_phone).replace(/[^\d+]/g, '');
        if (phoneClean.length < 10) {
            return res.status(400).json({ error: 'invalid_phone' });
        }

        // Проверка номера и пересечений в одной транзакции — защита от двойных броней
        await query('BEGIN');

        try {
            // Lock — берём номер с lock на чтение, чтобы параллельные запросы ждали
            const roomResult = await query(
                'SELECT id, name, price_per_day FROM rooms WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE FOR UPDATE',
                [room_id, req.tenant.id]
            );
            if (roomResult.rowCount === 0) {
                await query('ROLLBACK');
                return res.status(404).json({ error: 'room_not_found' });
            }
            const room = roomResult.rows[0];

            // Проверка пересечений
            const overlap = await query(
                `SELECT id FROM bookings
                 WHERE room_id = $1
                   AND status NOT IN ('cancelled', 'no_show')
                   AND check_in < $3
                   AND check_out > $2
                 LIMIT 1`,
                [room_id, check_in, check_out]
            );
            if (overlap.rowCount > 0) {
                await query('ROLLBACK');
                return res.status(409).json({ error: 'dates_unavailable' });
            }

            // Считаем сумму
            const nights = Math.ceil((checkOutDate - checkInDate) / 86400000);
            const total_price = nights * Number(room.price_per_day);

            // Создаём бронь
            const insertResult = await query(
                `INSERT INTO bookings (tenant_id, room_id, guest_name, guest_phone, guest_email,
                                       check_in, check_out, guests_count, total_price, source, notes, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'site', $10, 'new')
                 RETURNING *`,
                [req.tenant.id, room_id, guest_name, phoneClean, guest_email || null,
                 check_in, check_out, guests_count || 1, total_price, notes || null]
            );

            await query('COMMIT');

            const booking = insertResult.rows[0];

            // Отправляем уведомление в Telegram (async, не блокируем ответ)
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
