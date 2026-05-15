const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { branchFilter } = require('../../middleware/branch.middleware');
const c = require('./manager.controller');

router.use(authenticate, branchFilter, authorize('manager'));

// Maxsus rollar
router.get('/custom-roles', c.getCustomRoles);
router.post('/custom-roles', c.createCustomRole);
router.delete('/custom-roles/:id', c.deleteCustomRole);

// Maxsus mahsulot turlari
router.get('/custom-product-types', c.getCustomProductTypes);
router.post('/custom-product-types', c.createCustomProductType);
router.delete('/custom-product-types/:id', c.deleteCustomProductType);

module.exports = router;
