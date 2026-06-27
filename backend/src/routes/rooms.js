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

        res.json({
            rooms: result.rows,
            count: result.rowCount
        });
    } catch (err) {
        console.error('GET /rooms error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

export default router;
