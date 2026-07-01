import rateLimit from 'express-rate-limit';

// Rate limit для формы брони с публичного сайта
// 5 заявок с одного IP за 10 минут — этого хватит любому нормальному пользователю,
// но остановит бота, который шлёт 100 в секунду
export const bookingLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,       // 10 минут
    max: 5,                          // максимум 5 запросов
    standardHeaders: true,           // Возвращать rate limit info в headers `RateLimit-*`
    legacyHeaders: false,
    message: {
        error: 'too_many_requests',
        message: 'Слишком много запросов. Попробуйте через 10 минут.'
    },
    // Ключ — по IP; можно уточнить чтобы учитывать и tenant
    keyGenerator: (req) => {
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        const slug = req.query?.slug || 'no-slug';
        return `${ip}:${slug}`;
    }
});

// Rate limit на попытки логина
// 5 попыток за 15 минут с одного IP
export const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,       // 15 минут
    max: 5,                          // 5 попыток
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,    // не считать успешные логины
    message: {
        error: 'too_many_login_attempts',
        message: 'Слишком много попыток входа. Попробуйте через 15 минут.'
    }
});

// Общий rate limit на все API-запросы (защита от DDoS-подобных нагрузок)
// 100 запросов в минуту с одного IP — это очень много для реального пользователя,
// но остановит очевидные атаки
export const globalLimiter = rateLimit({
    windowMs: 60 * 1000,             // 1 минута
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limit_exceeded' }
});
