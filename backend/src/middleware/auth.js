import jwt from 'jsonwebtoken';
import { query } from '../db/pool.js';

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = '7d'; // токен живёт 7 дней

export function signToken(payload) {
    if (!JWT_SECRET) throw new Error('JWT_SECRET не задан');
    return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

// Middleware: проверка JWT из заголовка Authorization: Bearer <token>
export async function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization || '';
        const match = authHeader.match(/^Bearer\s+(.+)$/);
        if (!match) {
            return res.status(401).json({ error: 'unauthorized' });
        }

        let decoded;
        try {
            decoded = jwt.verify(match[1], JWT_SECRET);
        } catch (e) {
            return res.status(401).json({ error: 'invalid_token' });
        }

        // Грузим пользователя из БД (на случай если его деактивировали)
        const result = await query(
            `SELECT id, tenant_id, email, full_name, role, is_active
             FROM users WHERE id = $1 LIMIT 1`,
            [decoded.user_id]
        );

        if (result.rowCount === 0 || !result.rows[0].is_active) {
            return res.status(401).json({ error: 'user_inactive' });
        }

        const user = result.rows[0];

        // Тут же подгрузим tenant пользователя — пригодится в роутах админки
        const tenantResult = await query(
            `SELECT id, slug, name, owner_phone, plan, telegram_chat_id
             FROM tenants WHERE id = $1 AND is_active = TRUE LIMIT 1`,
            [user.tenant_id]
        );

        if (tenantResult.rowCount === 0) {
            return res.status(401).json({ error: 'tenant_inactive' });
        }

        req.user = user;
        req.tenant = tenantResult.rows[0];
        next();
    } catch (err) {
        console.error('requireAuth error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
}
