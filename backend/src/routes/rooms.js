import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireTenant } from '../middleware/tenant.js';

const router = Router();

// Список номеров текущего клиента
router.get('/', requireTenant, async (req, res) => {
    try {
        const result = await query(
            `SELECT id, name, type, capacity, price_per_day, description, photos, amenities, display_order
             FROM rooms
             WHERE tenant_id = $1 AND is_active = TRUE
             ORDER BY display_order, id`,
            [req.tenant.id]
        );
        res.json({ rooms: result.rows, count: result.rowCount });
    } catch (err) {
        console.error('GET /rooms error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

// Проверка доступности конкретного номера на даты
// GET /api/rooms/:id/availability?check_in=2026-07-01&check_out=2026-07-05
router.get('/:id/availability', requireTenant, async (req, res) => {
    try {
        const roomId = parseInt(req.params.id, 10);
        const { check_in, check_out } = req.query;

        if (!check_in || !check_out) {
            return res.status(400).json({ error: 'check_in and check_out required' });
        }

        // Проверяем, что номер принадлежит этому tenant'у
        const roomCheck = await query(
            'SELECT id FROM rooms WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE',
            [roomId, req.tenant.id]
        );
        if (roomCheck.rowCount === 0) {
            return res.status(404).json({ error: 'room_not_found' });
        }

        // Ищем пересечения с существующими бронями (не cancelled)
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
