import { query } from '../db/pool.js';

// Кэш tenant'ов в памяти, чтобы не дёргать БД на каждый запрос.
// Live до 60 секунд — для свежих изменений (новый клиент, смена плана и т.д.).
const tenantCache = new Map();
const CACHE_TTL_MS = 60_000;

function extractSlug(hostHeader) {
    if (!hostHeader) return null;

    // Убираем порт если есть (host:8080 → host)
    const hostname = hostHeader.split(':')[0].toLowerCase();

    // vbron.kz, www.vbron.kz, admin.vbron.kz, api.vbron.kz — не tenant'ы
    const reserved = new Set(['vbron.kz', 'www.vbron.kz', 'admin.vbron.kz', 'api.vbron.kz']);
    if (reserved.has(hostname)) return null;

    // Достаём первый сегмент: aquapark.vbron.kz → aquapark
    const match = hostname.match(/^([^.]+)\.vbron\.kz$/);
    return match ? match[1] : null;
}

async function findTenantBySlug(slug) {
    // Проверяем кэш
    const cached = tenantCache.get(slug);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.tenant;
    }

    const result = await query(
        'SELECT id, slug, name, owner_phone, plan, telegram_chat_id, is_active FROM tenants WHERE slug = $1 AND is_active = TRUE LIMIT 1',
        [slug]
    );

    const tenant = result.rows[0] || null;

    // Кэшируем (включая null, чтобы не долбить БД повторно по несуществующим)
    tenantCache.set(slug, {
        tenant,
        expiresAt: Date.now() + CACHE_TTL_MS
    });

    return tenant;
}

export async function resolveTenant(req, res, next) {
    try {
        const slug = extractSlug(req.headers.host);

        if (!slug) {
            // Это запрос к api.vbron.kz, vbron.kz и т.п. — не tenant-запрос.
            // Эндпоинты типа /api/health должны работать без tenant.
            req.tenant = null;
            return next();
        }

        const tenant = await findTenantBySlug(slug);

        if (!tenant) {
            return res.status(404).json({
                error: 'tenant_not_found',
                message: `Клиент с поддоменом "${slug}" не найден или неактивен`
            });
        }

        req.tenant = tenant;
        next();
    } catch (err) {
        console.error('resolveTenant error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
}

// Middleware, который требует tenant — для эндпоинтов, которые без него не имеют смысла
export function requireTenant(req, res, next) {
    if (!req.tenant) {
        return res.status(400).json({
            error: 'tenant_required',
            message: 'Этот эндпоинт доступен только через поддомен клиента'
        });
    }
    next();
}
