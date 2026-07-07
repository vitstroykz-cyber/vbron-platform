import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Список ключей settings, которые можно редактировать через админку
// (защита от того, чтобы через API нельзя было записать что попало)
const ALLOWED_SETTING_KEYS = [
    'address', 'lat', 'lng', 'map_2gis_url',
    'about_text', 'hero_title', 'hero_subtitle', 'hero_badge',
    'started_year', 'guests_count', 'rating', 'reviews_count',
    'cancellation_policy', 'rules_text',
    'checkin_time', 'checkout_time',
    'prepayment_percent',
    'hero_photo_url', 'about_photo_url',
    'promo1_icon', 'promo1_title', 'promo1_text',
    'promo2_icon', 'promo2_title', 'promo2_text',
    'promo3_icon', 'promo3_title', 'promo3_text'
];
// Список полей самого tenant, которые редактируются владельцем
const ALLOWED_TENANT_FIELDS = ['name', 'owner_phone', 'owner_email', 'telegram_chat_id'];

// GET /api/admin/tenant — вернуть настройки текущего клиента
router.get('/', async (req, res) => {
    try {
        const settingsResult = await query(
            `SELECT key, value FROM settings WHERE tenant_id = $1`,
            [req.tenant.id]
        );

        const settings = {};
        for (const row of settingsResult.rows) {
            settings[row.key] = row.value;
        }

        res.json({
            tenant: {
                id: req.tenant.id,
                slug: req.tenant.slug,
                name: req.tenant.name,
                owner_phone: req.tenant.owner_phone,
                owner_email: req.tenant.owner_email || null,
                telegram_chat_id: req.tenant.telegram_chat_id,
                plan: req.tenant.plan
            },
            settings
        });
    } catch (err) {
        console.error('GET /admin/tenant error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

// PATCH /api/admin/tenant — обновить поля tenant (name, phone и т.д.)
router.patch('/', async (req, res) => {
    try {
        const updates = [];
        const params = [];
        let idx = 1;

        for (const field of ALLOWED_TENANT_FIELDS) {
            if (field in req.body) {
                let value = req.body[field];
                if (typeof value === 'string') value = value.trim();
                if (value === '') value = null;

                // Простая валидация
                if (field === 'name' && (!value || value.length > 200)) {
                    return res.status(400).json({ error: 'invalid_name' });
                }
                if (field === 'owner_phone' && value && value.length > 50) {
                    return res.status(400).json({ error: 'invalid_phone' });
                }
                if (field === 'owner_email' && value && (!value.includes('@') || value.length > 200)) {
                    return res.status(400).json({ error: 'invalid_email' });
                }
                if (field === 'telegram_chat_id' && value && value.length > 100) {
                    return res.status(400).json({ error: 'invalid_chat_id' });
                }

                updates.push(`${field} = $${idx++}`);
                params.push(value);
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'nothing_to_update' });
        }

        params.push(req.tenant.id);

        const result = await query(
            `UPDATE tenants SET ${updates.join(', ')}
             WHERE id = $${idx}
             RETURNING id, name, owner_phone, owner_email, telegram_chat_id`,
            params
        );

        res.json({ ok: true, tenant: result.rows[0] });
    } catch (err) {
        console.error('PATCH /admin/tenant error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

// PUT /api/admin/tenant/settings — заменить весь набор настроек
// body: { settings: { key: value, ... } }
router.put('/settings', async (req, res) => {
    try {
        const { settings } = req.body;
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ error: 'invalid_settings' });
        }

        // Валидация
        for (const key of Object.keys(settings)) {
            if (!ALLOWED_SETTING_KEYS.includes(key)) {
                return res.status(400).json({ error: 'invalid_key', key });
            }
            const val = settings[key];
            if (val != null && (typeof val !== 'string' || val.length > 5000)) {
                return res.status(400).json({ error: 'invalid_value', key });
            }
        }

        await query('BEGIN');
        try {
            for (const [key, value] of Object.entries(settings)) {
                if (value == null || value === '') {
                    // Пустое — удаляем ключ
                    await query(
                        `DELETE FROM settings WHERE tenant_id = $1 AND key = $2`,
                        [req.tenant.id, key]
                    );
                } else {
                    // Upsert
                    await query(
                        `INSERT INTO settings (tenant_id, key, value) VALUES ($1, $2, $3)
                         ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
                        [req.tenant.id, key, value.trim()]
                    );
                }
            }
            await query('COMMIT');
            res.json({ ok: true });
        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }
    } catch (err) {
        console.error('PUT /admin/tenant/settings error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

export default router;
