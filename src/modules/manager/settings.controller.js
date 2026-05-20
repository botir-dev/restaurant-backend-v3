const pool = require('../../config/database');
const { success, error } = require('../../utils/response.utils');

/**
 * Filial sozlamalarini olish yoki avtomatik yaratish
 * GET /manager/settings
 */
const getSettings = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM branch_settings WHERE branch_id = $1`,
      [req.branchId]
    );

    if (result.rows.length === 0) {
      // Sozlamalar yo'q — default yaratib qaytarish
      const def = await pool.query(
        `INSERT INTO branch_settings (branch_id, service_fee_percent, waiter_commission_percent)
         VALUES ($1, 0, 0)
         ON CONFLICT (branch_id) DO UPDATE SET branch_id = EXCLUDED.branch_id
         RETURNING *`,
        [req.branchId]
      );
      return success(res, def.rows[0], 'Filial sozlamalari');
    }

    return success(res, result.rows[0], 'Filial sozlamalari');
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

/**
 * Filial sozlamalarini yangilash
 * PUT /manager/settings
 * Body: { service_fee_percent: number, waiter_commission_percent: number }
 */
const updateSettings = async (req, res) => {
  const { service_fee_percent, waiter_commission_percent } = req.body;

  if (service_fee_percent === undefined && waiter_commission_percent === undefined) {
    return error(res, 'Kamida bitta maydon talab qilinadi');
  }

  const sfp = parseFloat(service_fee_percent);
  const wcp = parseFloat(waiter_commission_percent);

  if (service_fee_percent !== undefined && (isNaN(sfp) || sfp < 0 || sfp > 100)) {
    return error(res, 'Xizmat haqi 0-100% orasida bo\'lishi kerak');
  }
  if (waiter_commission_percent !== undefined && (isNaN(wcp) || wcp < 0 || wcp > 100)) {
    return error(res, 'Ofitsiant komissiyasi 0-100% orasida bo\'lishi kerak');
  }

  try {
    const result = await pool.query(
      `INSERT INTO branch_settings (branch_id, service_fee_percent, waiter_commission_percent)
       VALUES ($1, $2, $3)
       ON CONFLICT (branch_id) DO UPDATE SET
         service_fee_percent = COALESCE($2, branch_settings.service_fee_percent),
         waiter_commission_percent = COALESCE($3, branch_settings.waiter_commission_percent),
         updated_at = NOW()
       RETURNING *`,
      [
        req.branchId,
        service_fee_percent !== undefined ? sfp : null,
        waiter_commission_percent !== undefined ? wcp : null,
      ]
    );

    return success(res, result.rows[0], 'Sozlamalar yangilandi');
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

/**
 * Ofitsiantlar kunlik maoshi
 * GET /manager/waiter-earnings?date=2026-05-20
 */
const getWaiterEarnings = async (req, res) => {
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];

  try {
    const result = await pool.query(
      `SELECT
         we.waiter_id,
         u.full_name as waiter_name,
         we.date,
         we.total_orders,
         we.total_order_amount,
         we.commission_percent,
         we.earned_amount
       FROM waiter_earnings we
       JOIN users u ON u.id = we.waiter_id
       WHERE we.branch_id = $1 AND we.date = $2
       ORDER BY we.earned_amount DESC`,
      [req.branchId, targetDate]
    );

    return success(res, result.rows, `${targetDate} kunlik maosh hisobi`);
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = { getSettings, updateSettings, getWaiterEarnings };
