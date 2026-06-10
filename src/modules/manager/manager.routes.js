const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { branchFilter } = require('../../middleware/branch.middleware');
const { checkTariffActive, requireFeature } = require('../../middleware/tariff.middleware');
const c = require('./manager.controller');
const sc = require('./settings.controller');

router.use(authenticate, branchFilter, authorize('manager'), checkTariffActive);

// Maxsus rollar
router.get('/custom-roles', c.getCustomRoles);
router.post('/custom-roles', c.createCustomRole);
router.delete('/custom-roles/:id', c.deleteCustomRole);

// Maxsus mahsulot turlari
router.get('/custom-product-types', c.getCustomProductTypes);
router.post('/custom-product-types', c.createCustomProductType);
router.delete('/custom-product-types/:id', c.deleteCustomProductType);

// Filial sozlamalari (xizmat haqi % va ofitsiant maoshi %)
router.get('/settings', sc.getSettings);
router.put('/settings', sc.updateSettings);

// Ofitsiant maoshi (kunlik) — staff_salary talab qiladi
router.get('/waiter-earnings', requireFeature('staff_salary'), sc.getWaiterEarnings);

module.exports = router;
