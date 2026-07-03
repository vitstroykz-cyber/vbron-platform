import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireTenant } from '../middleware/tenant.js';

const router = Router();

// Список номеров с занятыми датами на 90 дней вперёд
router.get('/', requireTenant, async (req, res) => {
    try {
        const roomsResult = await query(
            `SELECT id, name, type, capacity, price_per_day, description, photos, amenities, display_order
             FROM rooms
             WHERE tenant_id = $1 AND is_active = TRUE
             ORDER BY display_order, id`,
            [req.tenant.id]
        );

        // Тянем занятые даты на 90 дней вперёд для всех номеров разом
        const bookingsResult = await query(
            `SELECT room_id, check_in, check_out FROM bookings
             WHERE tenant_id = $1
               AND status NOT IN ('cancelled', 'no_show')
               AND check_out > CURRENT_DATE
               AND check_in < CURRENT_DATE + INTERVAL '90 days'`,
            [req.tenant.id]
        );

        // Группируем брони по room_id
        const bookingsByRoom = {};
        for (const b of bookingsResult.rows) {
            if (!bookingsByRoom[b.room_id]) bookingsByRoom[b.room_id] = [];
            bookingsByRoom[b.room_id].push({
                check_in: b.check_in.toISOString().slice(0, 10),
                check_out: b.check_out.toISOString().slice(0, 10)
            });
        }

        // Добавляем брони к каждому номеру
        const rooms = roomsResult.rows.map(r => ({
            ...r,
            bookings: bookingsByRoom[r.id] || []
        }));

        res.json({ rooms, count: rooms.length });
    } catch (err) {
        console.error('GET /rooms error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

// Проверка доступности конкретного номера на даты
router.get('/:id/availability', requireTenant, async (req, res) => {
    try {
        const roomId = parseInt(req.params.id, 10);
        const { check_in, check_out } = req.query;

        if (!check_in || !check_out) {
            return res.status(400).json({ error: 'check_in and check_out required' });
        }

        const roomCheck = await query(
            'SELECT id FROM rooms WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE',
            [roomId, req.tenant.id]
        );
        if (roomCheck.rowCount === 0) {
            return res.status(404).json({ error: 'room_not_found' });
        }

        const overlapping = await query(
            `SELECT id FROM bookings
             WHERE room_id = $1
               AND status NOT IN ('cancelled', 'no_show')
               AND check_in < $3
               AND check_out > $2`,
            [roomId, check_in, check_out]
        );

        res.json({
            available: overlapping.rowCount === 0,
            conflicting_bookings: overlapping.rowCount
        });
    } catch (err) {
        console.error('GET /availability error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

export default router;
