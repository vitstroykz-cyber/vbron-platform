import { Router } from 'express';
import { query } from '../db/pool.js';

const router = Router();

router.get('/', async (req, res) => {
    try {
        // Проверяем что БД доступна
        const dbResult = await query('SELECT NOW() as time, version() as version');

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime_seconds: Math.floor(process.uptime()),
            database: {
                connected: true,
                time: dbResult.rows[0].time,
                version: dbResult.rows[0].version.split(' ').slice(0, 2).join(' ')
            }
        });
    } catch (err) {
        res.status(503).json({
            status: 'error',
            database: { connected: false, error: err.message }
        });
    }
});

export default router;
