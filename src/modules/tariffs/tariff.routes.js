const express = require('express');
const router = express.Router();
const { authenticate, superAdminOnly } = require('../../middleware/auth.middleware');
const c = require('./tariff.controller');

// ─── FILIAL: o'z tarif holati (manager, cashier, waiter...) ──
router.get('/my', authenticate, c.getMyTariff);

// ─── SUPERADMIN ENDPOINTLARI ──────────────────────────────────
router.use(authenticate, superAdminOnly);

// Kalit so'z boshqaruvi
router.get('/config', c.getTariffConfig);
router.post('/config', c.setTariffConfig);

// Tarif loglari
router.get('/logs', c.getTariffLogs);

// Filial tariflari
router.get('/branches', c.getBranchTariffs);
router.get('/branches/:branchId', c.getBranchTariff);
router.post('/branches/:branchId/assign', c.assignBranchTariff);
router.put('/branches/:branchId/extend', c.extendBranchTariff);
router.delete('/branches/:branchId/revoke', c.revokeBranchTariff);

// Restoran tariflari (premium)
router.get('/restaurants/:restaurantId', c.getRestaurantTariff);
router.post('/restaurants/:restaurantId/assign', c.assignRestaurantTariff);
router.put('/restaurants/:restaurantId/extend', c.extendRestaurantTariff);

module.exports = router;
