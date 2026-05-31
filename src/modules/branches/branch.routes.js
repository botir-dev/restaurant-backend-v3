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
      `SELECT service_fee_percent, service_fee_enabled,
              vat_percent, vat_enabled,
              waiter_commission_percent, role_commissions
       FROM branch_settings WHERE branch_id = $1`,
      [req.user.branch_id]
    );
    const settings = result.rows[0] || {
      service_fee_percent: 0, service_fee_enabled: false,
      vat_percent: 12, vat_enabled: false,
      waiter_commission_percent: 0, role_commissions: {}
    };
    return success(res, settings);
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
});

// GET /branches/me/earnings — Xodim o'z maoshini ko'rish (barcha rollar)
router.get('/me/earnings', authenticate, branchFilter, async (req, res) => {
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];
  const userId = req.user.user_id;
  const role   = req.user.role;

  try {
    let todayRow, monthResult;
    if (role === 'waiter') {
      const r = await pool.query(
        `SELECT date, total_orders, total_order_amount, commission_percent, earned_amount
         FROM waiter_earnings WHERE waiter_id = $1 AND date = $2`,
        [userId, targetDate]
      );
      todayRow = r.rows[0];
      const month = targetDate.substring(0, 7);
      const mr = await pool.query(
        `SELECT COUNT(*)::int as days_worked,
                SUM(total_orders)::int as total_orders,
                SUM(total_order_amount) as total_order_amount,
                SUM(earned_amount) as total_earned
         FROM waiter_earnings
         WHERE waiter_id = $1 AND TO_CHAR(date, 'YYYY-MM') = $2`,
        [userId, month]
      );
      monthResult = mr.rows[0];
    } else {
      const r = await pool.query(
        `SELECT date, total_orders, total_order_amount, commission_percent, earned_amount
         FROM role_earnings WHERE user_id = $1 AND date = $2`,
        [userId, targetDate]
      );
      todayRow = r.rows[0];
      const month = targetDate.substring(0, 7);
      const mr = await pool.query(
        `SELECT COUNT(*)::int as days_worked,
                SUM(total_orders)::int as total_orders,
                SUM(total_order_amount) as total_order_amount,
                SUM(earned_amount) as total_earned
         FROM role_earnings
         WHERE user_id = $1 AND TO_CHAR(date, 'YYYY-MM') = $2`,
        [userId, month]
      );
      monthResult = mr.rows[0];
    }

    const today = todayRow || {
      date: targetDate, total_orders: 0,
      total_order_amount: 0, commission_percent: 0, earned_amount: 0,
    };

    return success(res, {
      today,
      month: monthResult || { days_worked: 0, total_orders: 0, total_order_amount: 0, total_earned: 0 },
      month_label: targetDate.substring(0, 7),
    });
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
});

module.exports = router;
