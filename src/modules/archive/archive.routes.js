const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { branchFilter } = require('../../middleware/branch.middleware');
const { checkTariffActive, requireFeature } = require('../../middleware/tariff.middleware');
const c = require('./archive.controller');

router.use(authenticate, branchFilter, authorize('manager'), checkTariffActive);

router.get('/',        c.getArchive);
router.get('/revenue', c.getRevenue);

// ─── Hisobot endpointlari (advanced_reports talab qiladi) ─────
router.get('/reports/revenue',             requireFeature('advanced_reports'), c.getRevenueReport);
router.get('/reports/top-products',        requireFeature('advanced_reports'), c.getTopProductsReport);
router.get('/reports/last-30-days',        requireFeature('advanced_reports'), c.getLast30DaysReport);
router.get('/reports/waiter-salary',       requireFeature('staff_salary'),     c.getWaiterSalaryReport);
router.get('/reports/top-waiters',         requireFeature('advanced_reports'), c.getTopWaitersReport);
router.get('/reports/order-history',       requireFeature('advanced_reports'), c.getOrderHistoryReport);
router.get('/reports/top-tables',          requireFeature('advanced_reports'), c.getTopTablesReport);

// ─── Yangi hisobot endpointlari ───────────────────────────────
router.get('/reports/product-history',     requireFeature('advanced_reports'), c.getProductHistoryReport);
router.get('/reports/expenses-30',         requireFeature('advanced_reports'), c.getExpenses30Report);
router.get('/reports/delivery',            requireFeature('advanced_reports'), c.getDeliveryReport);
router.get('/reports/takeaway',            requireFeature('advanced_reports'), c.getTakeawayReport);
router.get('/reports/last-30-extended',    requireFeature('advanced_reports'), c.getLast30DaysExtended);

module.exports = router;
