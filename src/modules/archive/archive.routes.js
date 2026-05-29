const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { branchFilter } = require('../../middleware/branch.middleware');
const c = require('./archive.controller');

router.use(authenticate, branchFilter, authorize('manager'));

router.get('/',        c.getArchive);
router.get('/revenue', c.getRevenue);

// ─── Hisobot endpointlari ─────────────────────────────────────
router.get('/reports/revenue',       c.getRevenueReport);
router.get('/reports/top-products',  c.getTopProductsReport);
router.get('/reports/last-30-days',  c.getLast30DaysReport);
router.get('/reports/waiter-salary', c.getWaiterSalaryReport);
router.get('/reports/top-waiters',   c.getTopWaitersReport);
router.get('/reports/order-history', c.getOrderHistoryReport);
router.get('/reports/top-tables',    c.getTopTablesReport);

module.exports = router;
