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
// DEBUG - inventory logs ni tekshirish (ishlatilgandan keyin o'chiring)
router.get('/debug/inv-logs', async (req, res) => {
  const pool = require('../../config/database');
  try {
    const r = await pool.query(
      `SELECT l.id, l.branch_id, l.change_amount, l.reason,
              TO_CHAR(l.created_at,'YYYY-MM-DD HH24:MI') as created,
              i.name
       FROM inventory_logs l
       JOIN inventory_items i ON i.id = l.inventory_item_id
       WHERE l.branch_id = $1
       ORDER BY l.created_at DESC LIMIT 20`,
      [req.branchId]
    );
    res.json({ count: r.rowCount, rows: r.rows, branchId: req.branchId });
  } catch(e) { res.json({ error: e.message }); }
});
