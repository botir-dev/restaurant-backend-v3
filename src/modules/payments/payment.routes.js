const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { branchFilter } = require('../../middleware/branch.middleware');
const c = require('./payment.controller');

router.use(authenticate, branchFilter);

router.post('/:orderId', authorize('cashier', 'manager'), c.processPayment);
router.get('/:orderId/check', authorize('cashier', 'manager'), c.generateCheck);

module.exports = router;
