import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Все эндпоинты требуют авторизацию
router.use(requireAuth);

// GET /api/admin/rooms — список номеров текущего tenant'a
router.get('/', async (req, res) => {
    try {
        const result = await query(
            `SELECT id, name, type, capacity, price_per_day, description,
                    photos, amenities, display_order, is_active, created_at
             FROM rooms
             WHERE tenant_id = $1
             ORDER BY display_order, id`,
            [req.tenant.id]
        );
        res.json({ rooms: result.rows, count: result.rowCount });
    } catch (err) {
        console.error('GET /admin/rooms error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

// GET /api/admin/rooms/:id — один номер
router.get('/:id', async (req, res) => {
    try {
        const roomId = parseInt(req.params.id, 10);
        const result = await query(
            `SELECT id, name, type, capacity, price_per_day, description,
                    photos, amenities, display_order, is_active
             FROM rooms
             WHERE id = $1 AND tenant_id = $2`,
            [roomId, req.tenant.id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'room_not_found' });
        }
        res.json({ room: result.rows[0] });
    } catch (err) {
        console.error('GET /admin/rooms/:id error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

// Валидация полей номера
function validateRoomData(data) {
    const errors = [];

    if (data.name !== undefined) {
        if (typeof data.name !== 'string' || data.name.trim().length < 2) {
            errors.push('name_too_short');
        }
        if (data.name.length > 200) errors.push('name_too_long');
    }

    if (data.type !== undefined && data.type != null) {
        const allowedTypes = ['cottage', 'room', 'sauna', 'gazebo', 'other'];
        if (!allowedTypes.includes(data.type)) errors.push('invalid_type');
    }

    if (data.capacity !== undefined) {
        const cap = parseInt(data.capacity, 10);
        if (isNaN(cap) || cap < 1 || cap > 50) errors.push('invalid_capacity');
    }

    if (data.price_per_day !== undefined) {
        const price = Number(data.price_per_day);
        if (isNaN(price) || price < 0 || price > 10_000_000) errors.push('invalid_price');
    }

    if (data.description !== undefined && data.description != null) {
        if (typeof data.description !== 'string' || data.description.length > 5000) {
            errors.push('description_too_long');
        }
    }

    if (data.photos !== undefined && data.photos != null) {
        if (!Array.isArray(data.photos)) errors.push('photos_must_be_array');
        else if (data.photos.length > 30) errors.push('too_many_photos');
        else if (data.photos.some(p => typeof p !== 'string' || p.length > 500)) {
            errors.push('invalid_photo_url');
        }
    }

    if (data.amenities !== undefined && data.amenities != null) {
        if (!Array.isArray(data.amenities)) errors.push('amenities_must_be_array');
        else if (data.amenities.length > 30) errors.push('too_many_amenities');
        else if (data.amenities.some(a => typeof a !== 'string' || a.length > 100)) {
            errors.push('invalid_amenity');
        }
    }

    if (data.display_order !== undefined) {
        const order = parseInt(data.display_order, 10);
        if (isNaN(order) || order < 0 || order > 999) errors.push('invalid_display_order');
    }

    return errors;
}

// POST /api/admin/rooms — создать номер
router.post('/', async (req, res) => {
    try {
        const {
            name, type, capacity, price_per_day, description,
            photos, amenities, display_order, is_active
        } = req.body;

        // Обязательные при создании
        if (!name || price_per_day == null) {
            return res.status(400).json({ error: 'missing_required_fields' });
        }

        const errors = validateRoomData(req.body);
        if (errors.length > 0) {
            return res.status(400).json({ error: 'validation_failed', details: errors });
        }

        const result = await query(
            `INSERT INTO rooms (tenant_id, name, type, capacity, price_per_day, description,
                                photos, amenities, display_order, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
                req.tenant.id,
                name.trim(),
                type || 'room',
                capacity || 2,
                price_per_day,
                description ? description.trim() : null,
                JSON.stringify(photos || []),
                JSON.stringify(amenities || []),
                display_order || 0,
                is_active !== false
            ]
        );

        res.status(201).json({ ok: true, room: result.rows[0] });
    } catch (err) {
        console.error('POST /admin/rooms error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

// PATCH /api/admin/rooms/:id — обновить номер
router.patch('/:id', async (req, res) => {
    try {
        const roomId = parseInt(req.params.id, 10);

        const errors = validateRoomData(req.body);
        if (errors.length > 0) {
            return res.status(400).json({ error: 'validation_failed', details: errors });
        }

        // Проверим что номер принадлежит нашему tenant'у
        const check = await query(
            'SELECT id FROM rooms WHERE id = $1 AND tenant_id = $2',
            [roomId, req.tenant.id]
        );
        if (check.rowCount === 0) {
            return res.status(404).json({ error: 'room_not_found' });
        }

        // Строим динамический UPDATE
        const allowedFields = ['name', 'type', 'capacity', 'price_per_day',
                               'description', 'photos', 'amenities',
                               'display_order', 'is_active'];
        const updates = [];
        const params = [];
        let idx = 1;

        for (const field of allowedFields) {
            if (field in req.body) {
                let value = req.body[field];
                if (field === 'photos' || field === 'amenities') {
                    value = JSON.stringify(value || []);
                } else if (typeof value === 'string') {
                    value = value.trim();
                }
                updates.push(`${field} = $${idx++}`);
                params.push(value);
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'nothing_to_update' });
        }

        params.push(roomId, req.tenant.id);

        const result = await query(
            `UPDATE rooms SET ${updates.join(', ')}
             WHERE id = $${idx++} AND tenant_id = $${idx}
             RETURNING *`,
            params
        );

        res.json({ ok: true, room: result.rows[0] });
    } catch (err) {
        console.error('PATCH /admin/rooms error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

// DELETE /api/admin/rooms/:id — мягкое удаление (is_active = false)
// Не удаляем физически, чтобы сохранить связь с бронями
router.delete('/:id', async (req, res) => {
    try {
        const roomId = parseInt(req.params.id, 10);

        const result = await query(
            `UPDATE rooms SET is_active = FALSE
             WHERE id = $1 AND tenant_id = $2
             RETURNING id`,
            [roomId, req.tenant.id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'room_not_found' });
        }

        res.json({ ok: true, deactivated: true });
    } catch (err) {
        console.error('DELETE /admin/rooms error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

// POST /api/admin/rooms/reorder — массовое изменение порядка
// body: { order: [{id: 1, display_order: 0}, {id: 2, display_order: 1}, ...] }
router.post('/reorder', async (req, res) => {
    try {
        const { order } = req.body;
        if (!Array.isArray(order)) {
            return res.status(400).json({ error: 'invalid_order' });
        }

        await query('BEGIN');
        try {
            for (const item of order) {
                await query(
                    `UPDATE rooms SET display_order = $1
                     WHERE id = $2 AND tenant_id = $3`,
                    [parseInt(item.display_order, 10) || 0, item.id, req.tenant.id]
                );
            }
            await query('COMMIT');
            res.json({ ok: true });
        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }
    } catch (err) {
        console.error('POST /admin/rooms/reorder error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

export default router;
