import { Router } from 'express';
import bcrypt from 'bcrypt';
import { query } from '../db/pool.js';
import { signToken, requireAuth } from '../middleware/auth.js';

const router = Router();

// POST /api/admin/login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'email_password_required' });
        }

        const result = await query(
            `SELECT id, tenant_id, email, password_hash, full_name, role, is_active
             FROM users WHERE email = $1 LIMIT 1`,
            [email.toLowerCase().trim()]
        );

        if (result.rowCount === 0 || !result.rows[0].is_active) {
            // Не палим, что email не найден — отвечаем одинаково
            return res.status(401).json({ error: 'invalid_credentials' });
        }

        const user = result.rows[0];
        const passwordOk = await bcrypt.compare(password, user.password_hash);
        if (!passwordOk) {
            return res.status(401).json({ error: 'invalid_credentials' });
        }

        // Обновляем last_login_at
        await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

        const token = signToken({ user_id: user.id, tenant_id: user.tenant_id });

        res.json({
            ok: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role
            }
        });
    } catch (err) {
        console.error('POST /login error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

// GET /api/admin/me — проверка токена + информация о текущем пользователе
router.get('/me', requireAuth, (req, res) => {
    res.json({
        user: {
            id: req.user.id,
            email: req.user.email,
            full_name: req.user.full_name,
            role: req.user.role
        },
        tenant: {
            id: req.tenant.id,
            slug: req.tenant.slug,
            name: req.tenant.name,
            plan: req.tenant.plan
        }
    });
});

export default router;
