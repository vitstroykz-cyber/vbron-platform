// Простая защита супер-админки через заголовок с паролем.
// Это не JWT — потому что супер-админка используется только тобой,
// не нужна сложная система пользователей.
export function requireSuperAdmin(req, res, next) {
    const password = req.headers['x-superadmin-password'];
    if (!password || password !== process.env.SUPERADMIN_PASSWORD) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    next();
}
