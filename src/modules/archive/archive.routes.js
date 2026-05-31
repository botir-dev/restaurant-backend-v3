const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { branchFilter } = require('../../middleware/branch.middleware');
const c = require('./archive.controller');

router.use(authenticate, branchFilter, authorize('manager'));

router.get('/',        c.getArchive);
router.get('/revenue', c.getRevenue);

// ─── Hisobot endpointlari ─────────────────────────────────────
router.get('/reports/revenue',             c.getRevenueReport);
router.get('/reports/top-products',        c.getTopProductsReport);
router.get('/reports/last-30-days',        c.getLast30DaysReport);
router.get('/reports/waiter-salary',       c.getWaiterSalaryReport);
router.get('/reports/top-waiters',         c.getTopWaitersReport);
router.get('/reports/order-history',       c.getOrderHistoryReport);
router.get('/reports/top-tables',          c.getTopTablesReport);

// ─── Yangi hisobot endpointlari ───────────────────────────────
router.get('/reports/product-history',     c.getProductHistoryReport);
router.get('/reports/expenses-30',         c.getExpenses30Report);
router.get('/reports/delivery',            c.getDeliveryReport);
router.get('/reports/takeaway',            c.getTakeawayReport);
router.get('/reports/last-30-extended',    c.getLast30DaysExtended);

module.exports = router;
