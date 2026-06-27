import bcrypt from 'bcrypt';
import pg from 'pg';
import 'dotenv/config';

const { Client } = pg;

const [,, tenantSlug, email, password, fullName] = process.argv;

if (!tenantSlug || !email || !password) {
    console.error('Usage: node scripts/create-user.js <tenant_slug> <email> <password> [full_name]');
    process.exit(1);
}

const client = new Client({
    host: process.env.POSTGRES_HOST || 'vbron_postgres',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'vbron',
    user: process.env.POSTGRES_USER || 'vbron_user',
    password: process.env.POSTGRES_PASSWORD
});

await client.connect();

const tenantResult = await client.query('SELECT id FROM tenants WHERE slug = $1', [tenantSlug]);
if (tenantResult.rowCount === 0) {
    console.error(`Tenant с slug "${tenantSlug}" не найден`);
    process.exit(1);
}
const tenantId = tenantResult.rows[0].id;

const hash = await bcrypt.hash(password, 10);

const result = await client.query(
    `INSERT INTO users (tenant_id, email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4, 'owner')
     RETURNING id, email`,
    [tenantId, email.toLowerCase(), hash, fullName || null]
);

console.log('Создан пользователь:', result.rows[0]);
await client.end();
