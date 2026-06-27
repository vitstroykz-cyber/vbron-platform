import pg from 'pg';

const { Pool } = pg;

// Пул соединений с PostgreSQL.
// Пул переиспользует соединения, чтобы не создавать новое на каждый запрос.
const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'vbron_postgres',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'vbron',
    user: process.env.POSTGRES_USER || 'vbron_user',
    password: process.env.POSTGRES_PASSWORD,
    max: 20,                      // максимум 20 одновременных соединений
    idleTimeoutMillis: 30000,     // закрыть idle-соединение через 30 сек
    connectionTimeoutMillis: 5000 // таймаут на установку соединения
});

pool.on('error', (err) => {
    console.error('Неожиданная ошибка в пуле PostgreSQL:', err);
});

// Хелпер для запросов с логированием в dev-режиме.
export async function query(text, params) {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        if (process.env.NODE_ENV !== 'production') {
            console.log('SQL', { text: text.slice(0, 80), duration: `${duration}ms`, rows: result.rowCount });
        }
        return result;
    } catch (err) {
        console.error('SQL error:', err.message, { text: text.slice(0, 80) });
        throw err;
    }
}

export default pool;
