import { Router } from 'express';
import { requireTenant } from '../middleware/tenant.js';

const router = Router();

// Информация о текущем клиенте
router.get('/', requireTenant, (req, res) => {
    const { id, slug, name, owner_phone, plan } = req.tenant;
    res.json({
        id,
        slug,
        name,
        owner_phone,
        plan
    });
});

export default router;
