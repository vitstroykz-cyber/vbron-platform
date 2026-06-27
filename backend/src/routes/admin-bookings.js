import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Все эндпоинты требуют авторизацию
router.use(requireAuth);

// GET /api/admin/bookings — список броней с фильтрами
// ?status=new,confirmed&from=2026-01-01&to=2026-12-31
router.get('/', async (req, res) => {
    try {
        const { status, from, to } = req.query;

        const conditions = ['b.tenant_id = $1'];
        const params = [req.tenant.id];
        let paramIdx = 2;

        if (status) {
            const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
            if (statuses.length > 0) {
                conditions.push(`b.status = ANY($${paramIdx})`);
                params.push(statuses);
                paramIdx++;
            }
        }

        if (from) {
            conditions.push(`b.check_in >= $${paramIdx}`);
            params.push(from);
            paramIdx++;
        }
        if (to) {
            conditions.push(`b.check_out <= $${paramIdx}`);
            params.push(to);
            paramIdx++;
        }

        const sql = `
            SELECT b.id, b.guest_name, b.guest_phone, b.guest_email,
                   b.check_in, b.check_out, b.guests_count, b.total_price,
                   b.status, b.payment_status, b.source, b.notes, b.created_at,
                   r.id AS room_id, r.name AS room_name, r.type AS room_type
            FROM bookings b
            JOIN rooms r ON r.id = b.room_id
            WHERE ${conditions.join(' AND ')}
            ORDER BY b.created_at DESC
            LIMIT 200
        `;

        const result = await query(sql, params);
        res.json({ bookings: result.rows, count: result.rowCount });
    } catch (err) {
        console.error('GET /admin/bookings error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

// PATCH /api/admin/bookings/:id — обновление статуса/полей
router.patch('/:id', async (req, res) => {
    try {
        const bookingId = parseInt(req.params.id, 10);
        const { status, payment_status, notes } = req.body;

        const allowedStatuses = ['new', 'confirmed', 'paid', 'cancelled', 'completed', 'no_show'];
        const allowedPaymentStatuses = ['unpaid', 'prepaid', 'paid', 'refunded'];

        const updates = [];
        const params = [];
        let idx = 1;

        if (status !== undefined) {
            if (!allowedStatuses.includes(status)) {
                return res.status(400).json({ error: 'invalid_status' });
            }
            updates.push(`status = $${idx++}`);
            params.push(status);
        }
        if (payment_status !== undefined) {
            if (!allowedPaymentStatuses.includes(payment_status)) {
                return res.status(400).json({ error: 'invalid_payment_status' });
            }
            updates.push(`payment_status = $${idx++}`);
            params.push(payment_status);
        }
        if (notes !== undefined) {
            updates.push(`notes = $${idx++}`);
            params.push(notes);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'nothing_to_update' });
        }

        params.push(bookingId, req.tenant.id);

        const result = await query(
            `UPDATE bookings SET ${updates.join(', ')}
             WHERE id = $${idx++} AND tenant_id = $${idx}
             RETURNING id, status, payment_status, notes`,
            params
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'booking_not_found' });
        }

        res.json({ ok: true, booking: result.rows[0] });
    } catch (err) {
        console.error('PATCH /admin/bookings error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

// POST /api/admin/bookings/manual — ручная бронь (клиент позвонил)
router.post('/manual', async (req, res) => {
    try {
        const { room_id, guest_name, guest_phone, check_in, check_out, guests_count, notes, status } = req.body;

        if (!room_id || !guest_name || !guest_phone || !check_in || !check_out) {
            return res.status(400).json({ error: 'missing_required_fields' });
        }

        const checkInDate = new Date(check_in);
        const checkOutDate = new Date(check_out);
        if (isNaN(checkInDate) || isNaN(checkOutDate) || checkOutDate <= checkInDate) {
            return res.status(400).json({ error: 'invalid_dates' });
        }

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

            const nights = Math.ceil((checkOutDate - checkInDate) / 86400000);
            const total_price = nights * Number(room.price_per_day);

            const insertResult = await query(
                `INSERT INTO bookings (tenant_id, room_id, guest_name, guest_phone,
                                       check_in, check_out, guests_count, total_price, source, notes, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual', $9, $10)
                 RETURNING *`,
                [req.tenant.id, room_id, guest_name, guest_phone,
                 check_in, check_out, guests_count || 1, total_price, notes || null, status || 'confirmed']
            );

            await query('COMMIT');
            res.status(201).json({ ok: true, booking: insertResult.rows[0] });
        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }
    } catch (err) {
        console.error('POST /admin/bookings/manual error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

export default router;
