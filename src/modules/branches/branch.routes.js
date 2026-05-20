const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware');
const { branchFilter } = require('../../middleware/branch.middleware');
const pool = require('../../config/database');
const { success, error } = require('../../utils/response.utils');

// GET /branches/me — Hodim o'z filiali ma'lumotini ko'rishi
router.get('/me', authenticate, branchFilter, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, address, phone FROM branches WHERE id = $1`,
      [req.user.branch_id]
    );
    if (result.rows.length === 0) return error(res, 'Filial topilmadi', 404);
    return success(res, result.rows[0]);
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
});

// GET /branches/me/settings — Filial sozlamalarini ko'rish (barcha rollar)
router.get('/me/settings', authenticate, branchFilter, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT service_fee_percent, waiter_commission_percent
       FROM branch_settings WHERE branch_id = $1`,
      [req.user.branch_id]
    );
    const settings = result.rows[0] || { service_fee_percent: 0, waiter_commission_percent: 0 };
    return success(res, settings);
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
});

// GET /branches/me/earnings — Ofitsiant o'z maoshini ko'rish
router.get('/me/earnings', authenticate, branchFilter, async (req, res) => {
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];

  try {
    const result = await pool.query(
      `SELECT date, total_orders, total_order_amount,
              commission_percent, earned_amount
       FROM waiter_earnings
       WHERE waiter_id = $1 AND date = $2`,
      [req.user.user_id, targetDate]
    );

    const today = result.rows[0] || {
      date: targetDate,
      total_orders: 0,
      total_order_amount: 0,
      commission_percent: 0,
      earned_amount: 0,
    };

    // Oylik jami
    const month = targetDate.substring(0, 7); // "2026-05"
    const monthResult = await pool.query(
      `SELECT
         COUNT(*)::int as days_worked,
         SUM(total_orders)::int as total_orders,
         SUM(total_order_amount) as total_order_amount,
         SUM(earned_amount) as total_earned
       FROM waiter_earnings
       WHERE waiter_id = $1 AND TO_CHAR(date, 'YYYY-MM') = $2`,
      [req.user.user_id, month]
    );

    return success(res, {
      today,
      month: monthResult.rows[0] || { days_worked: 0, total_orders: 0, total_order_amount: 0, total_earned: 0 },
      month_label: month,
    });
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
});

module.exports = router;
