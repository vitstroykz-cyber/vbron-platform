import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireTenant } from '../middleware/tenant.js';

const router = Router();

// Информация о текущем клиенте (публичные поля + настройки)
router.get('/', requireTenant, async (req, res) => {
    try {
        const { id, slug, name, owner_phone, plan } = req.tenant;

        const settingsResult = await query(
            `SELECT key, value FROM settings WHERE tenant_id = $1`,
            [id]
        );

        const settings = {};
        for (const row of settingsResult.rows) {
            settings[row.key] = row.value;
        }

        // Публичная статистика для соц-пруфа
        const statsResult = await query(
            `SELECT COUNT(*)::int AS bookings_24h
             FROM bookings
             WHERE tenant_id = $1
               AND created_at >= NOW() - INTERVAL '24 hours'
               AND status NOT IN ('cancelled', 'no_show')`,
            [id]
        );
        // Показываем реальные + минимум 3, чтобы демо не выглядело мёртвым
        const bookings24h = Math.max(3, statsResult.rows[0].bookings_24h);

        res.json({
            id,
            slug,
            name,
            owner_phone,
            plan,
            settings,
            stats: {
                bookings_24h: bookings24h
            }
        });
    } catch (err) {
        console.error('GET /tenant error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

export default router;
