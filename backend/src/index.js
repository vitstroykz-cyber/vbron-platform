import express from 'express';
import cors from 'cors';
import 'dotenv/config';

import { resolveTenant } from './middleware/tenant.js';
import healthRouter from './routes/health.js';
import tenantRouter from './routes/tenant.js';
import roomsRouter from './routes/rooms.js';
import bookingsRouter from './routes/bookings.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Доверяем proxy-заголовкам от NPM, иначе req.headers.host может быть кривым
app.set('trust proxy', true);

// Базовые middleware
app.use(express.json({ limit: '1mb' }));
app.use(cors({
    origin: true,        // отражаем Origin запроса; ужесточим, когда будут конкретные домены
    credentials: true
}));

// Определение tenant по поддомену — на каждый запрос
app.use(resolveTenant);

// Логирование запросов (простое, для разработки)
app.use((req, res, next) => {
    const tenantInfo = req.tenant ? `[${req.tenant.slug}]` : '[no-tenant]';
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${tenantInfo}`);
    next();
});

// Роуты
app.use('/api/health', healthRouter);
app.use('/api/tenant', tenantRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/bookings', bookingsRouter);

// Корень API — для проверки
app.get('/', (req, res) => {
    res.json({
        service: 'vbron-backend',
        version: '0.1.0',
        tenant: req.tenant ? { slug: req.tenant.slug, name: req.tenant.name } : null
    });
});

// 404 для неизвестных роутов
app.use((req, res) => {
    res.status(404).json({ error: 'not_found', path: req.originalUrl });
});

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`vbron-backend listening on port ${PORT}`);
    console.log(`NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
});
