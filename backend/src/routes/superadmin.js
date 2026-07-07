import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { query } from '../db/pool.js';
import { requireSuperAdmin } from '../middleware/superadmin.js';

const router = Router();
router.use(requireSuperAdmin);

// GET /api/superadmin/tenants — список всех клиентов платформы
router.get('/tenants', async (req, res) => {
    try {
        const result = await query(
            `SELECT t.id, t.slug, t.name, t.owner_name, t.owner_phone, t.plan, t.is_active, t.created_at,
                    (SELECT COUNT(*) FROM rooms r WHERE r.tenant_id = t.id AND r.is_active = TRUE) AS rooms_count,
                    (SELECT COUNT(*) FROM bookings b WHERE b.tenant_id = t.id) AS bookings_count,
                    (SELECT email FROM users u WHERE u.tenant_id = t.id AND u.role = 'owner' LIMIT 1) AS owner_email
             FROM tenants t
             ORDER BY t.created_at DESC`
        );
        res.json({ tenants: result.rows });
    } catch (err) {
        console.error('GET /superadmin/tenants error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

// Проверка что slug доступен и валиден
function validateSlug(slug) {
    if (!slug || typeof slug !== 'string') return false;
    return /^[a-z0-9-]{2,50}$/.test(slug);
}

// Генератор случайного пароля для нового владельца
function generatePassword() {
    return crypto.randomBytes(6).toString('hex'); // 12 символов, hex
}

// POST /api/superadmin/tenants — создать нового клиента целиком
// body: { slug, name, owner_name, owner_phone, owner_email, plan, telegram_chat_id,
//         rooms: [{ name, type, capacity, price_per_day, description }] }
router.post('/tenants', async (req, res) => {
    try {
        const { slug, name, owner_name, owner_phone, owner_email, plan, telegram_chat_id, rooms } = req.body;

        if (!validateSlug(slug)) {
            return res.status(400).json({ error: 'invalid_slug', message: 'Только строчные латинские буквы, цифры и дефис, 2-50 символов' });
        }
        if (!name || name.trim().length < 2) {
            return res.status(400).json({ error: 'invalid_name' });
        }
        if (!owner_phone) {
            return res.status(400).json({ error: 'owner_phone_required' });
        }

        const allowedPlans = ['start', 'bron', 'premium'];
        const finalPlan = allowedPlans.includes(plan) ? plan : 'start';

        // Проверка что slug свободен
        const existing = await query('SELECT id FROM tenants WHERE slug = $1', [slug]);
        if (existing.rowCount > 0) {
            return res.status(409).json({ error: 'slug_taken' });
        }

        await query('BEGIN');
        try {
            // 1. Создаём tenant
            const tenantResult = await query(
                `INSERT INTO tenants (slug, name, owner_name, owner_phone, owner_email, plan, telegram_chat_id, is_active)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
                 RETURNING id, slug, name`,
                [slug, name.trim(), owner_name || null, owner_phone, owner_email || null, finalPlan, telegram_chat_id || null]
            );
            const tenant = tenantResult.rows[0];

            // 2. Создаём владельца с случайным паролем
            const ownerEmail = owner_email || `${slug}@vbron.kz`;
            const generatedPassword = generatePassword();
            const passwordHash = await bcrypt.hash(generatedPassword, 10);

            await query(
                `INSERT INTO users (tenant_id, email, password_hash, full_name, role, is_active)
                 VALUES ($1, $2, $3, $4, 'owner', TRUE)`,
                [tenant.id, ownerEmail.toLowerCase(), passwordHash, owner_name || name]
            );

            // 3. Создаём стартовые номера, если переданы
            const createdRooms = [];
            if (Array.isArray(rooms)) {
                for (let i = 0; i < rooms.length; i++) {
                    const r = rooms[i];
                    if (!r.name || r.price_per_day == null) continue;
                    const roomResult = await query(
                        `INSERT INTO rooms (tenant_id, name, type, capacity, price_per_day, description, display_order, is_active)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
                         RETURNING id, name`,
                        [tenant.id, r.name, r.type || 'room', r.capacity || 2, r.price_per_day, r.description || null, i]
                    );
                    createdRooms.push(roomResult.rows[0]);
                }
            }

            await query('COMMIT');

            res.status(201).json({
                ok: true,
                tenant,
                owner: {
                    email: ownerEmail,
                    password: generatedPassword // Показываем один раз — потом не хранится в открытом виде
                },
                rooms: createdRooms,
                urls: {
                    site: `https://${slug}.vbron.kz`,
                    admin: `https://admin.vbron.kz`
                }
            });
        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }
    } catch (err) {
        console.error('POST /superadmin/tenants error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

// PATCH /api/superadmin/tenants/:id — вкл/выкл клиента, сменить план
router.patch('/tenants/:id', async (req, res) => {
    try {
        const tenantId = parseInt(req.params.id, 10);
        const { is_active, plan } = req.body;

        const updates = [];
        const params = [];
        let idx = 1;

        if (is_active !== undefined) {
            updates.push(`is_active = $${idx++}`);
            params.push(!!is_active);
        }
        if (plan !== undefined) {
            const allowedPlans = ['start', 'bron', 'premium'];
            if (!allowedPlans.includes(plan)) {
                return res.status(400).json({ error: 'invalid_plan' });
            }
            updates.push(`plan = $${idx++}`);
            params.push(plan);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'nothing_to_update' });
        }

        params.push(tenantId);
        const result = await query(
            `UPDATE tenants SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, slug, is_active, plan`,
            params
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'tenant_not_found' });
        }

        res.json({ ok: true, tenant: result.rows[0] });
    } catch (err) {
        console.error('PATCH /superadmin/tenants error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

// POST /api/superadmin/tenants/:id/reset-password — сбросить пароль владельца
router.post('/tenants/:id/reset-password', async (req, res) => {
    try {
        const tenantId = parseInt(req.params.id, 10);

        const userResult = await query(
            `SELECT id, email FROM users WHERE tenant_id = $1 AND role = 'owner' LIMIT 1`,
            [tenantId]
        );
        if (userResult.rowCount === 0) {
            return res.status(404).json({ error: 'owner_not_found' });
        }

        const newPassword = generatePassword();
        const passwordHash = await bcrypt.hash(newPassword, 10);

        await query(
            `UPDATE users SET password_hash = $1 WHERE id = $2`,
            [passwordHash, userResult.rows[0].id]
        );

        res.json({
            ok: true,
            email: userResult.rows[0].email,
            new_password: newPassword
        });
    } catch (err) {
        console.error('POST /superadmin/reset-password error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

export default router;
