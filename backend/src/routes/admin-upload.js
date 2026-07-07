import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Куда сохраняем — привязано к volume в docker-compose (см. ниже)
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/uploads';
const ROOMS_FULL_DIR = path.join(UPLOAD_DIR, 'rooms', 'full');
const ROOMS_THUMB_DIR = path.join(UPLOAD_DIR, 'rooms', 'thumb');
const TENANT_DIR = path.join(UPLOAD_DIR, 'tenant');

// Создаём папки при старте, если их нет
await fs.mkdir(ROOMS_FULL_DIR, { recursive: true });
await fs.mkdir(ROOMS_THUMB_DIR, { recursive: true });
await fs.mkdir(TENANT_DIR, { recursive: true });

// Multer — принимаем в память (потом обработаем через sharp)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5 МБ
        files: 1
    },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowed.includes(file.mimetype)) {
            return cb(new Error('invalid_type'));
        }
        cb(null, true);
    }
});

// POST /api/admin/upload — загрузка фото
router.post('/', (req, res) => {
    upload.single('photo')(req, res, async (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'file_too_large', max_mb: 5 });
            }
            if (err.message === 'invalid_type') {
                return res.status(400).json({ error: 'invalid_type', message: 'Только JPG, PNG или WebP' });
            }
            console.error('multer error:', err);
            return res.status(400).json({ error: 'upload_failed' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'no_file' });
        }
        try {
            const uploadType = req.query.type === 'tenant' ? 'tenant' : 'room';
            const hash = crypto.randomBytes(8).toString('hex');
            const tenantSlug = req.tenant.slug;
            const filename = `${tenantSlug}_${hash}.jpg`;

            let url, thumbUrl;

            if (uploadType === 'tenant') {
                // Фото сайта (hero, about) — без миниатюры, сразу побольше
                const fullPath = path.join(TENANT_DIR, filename);
                await sharp(req.file.buffer)
                    .rotate()
                    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 85, progressive: true, mozjpeg: true })
                    .toFile(fullPath);

                url = `https://cdn.vbron.kz/tenant/${filename}`;
                thumbUrl = url;
            } else {
                const fullPath = path.join(ROOMS_FULL_DIR, filename);
                const thumbPath = path.join(ROOMS_THUMB_DIR, filename);

                await sharp(req.file.buffer)
                    .rotate()
                    .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 82, progressive: true, mozjpeg: true })
                    .toFile(fullPath);

                await sharp(req.file.buffer)
                    .rotate()
                    .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 75, progressive: true, mozjpeg: true })
                    .toFile(thumbPath);

                url = `https://cdn.vbron.kz/rooms/full/${filename}`;
                thumbUrl = `https://cdn.vbron.kz/rooms/thumb/${filename}`;
            }

            res.json({ ok: true, url, thumb_url: thumbUrl, filename });
        } catch (err) {
            console.error('upload processing error:', err);
            res.status(500).json({ error: 'processing_failed' });
        }
    });
});

// DELETE /api/admin/upload — удаление файла
// body: { filename: 'abc123.jpg' } или { url: 'https://cdn.vbron.kz/rooms/full/abc123.jpg' }
router.delete('/', async (req, res) => {
    try {
        let filename = req.body?.filename;

        // Если передали url — вытащим имя файла
        if (!filename && req.body?.url) {
            const match = req.body.url.match(/\/rooms\/(full|thumb)\/([a-z0-9_.-]+\.jpg)$/i);
            if (match) filename = match[2];
        }

        if (!filename || !/^[a-z0-9_.-]+\.jpg$/i.test(filename)) {
            return res.status(400).json({ error: 'invalid_filename' });
        }

        // Проверяем что файл принадлежит этому tenant (по префиксу имени)
        if (!filename.startsWith(req.tenant.slug + '_')) {
            return res.status(403).json({ error: 'forbidden' });
        }

        const fullPath = path.join(ROOMS_FULL_DIR, filename);
        const thumbPath = path.join(ROOMS_THUMB_DIR, filename);

        // Удаляем оба варианта (игнорируем если один не существует)
        await Promise.all([
            fs.unlink(fullPath).catch(() => {}),
            fs.unlink(thumbPath).catch(() => {})
        ]);

        res.json({ ok: true });
    } catch (err) {
        console.error('delete file error:', err);
        res.status(500).json({ error: 'delete_failed' });
    }
});

export default router;
