const pool = require('../../config/database');
const { success, error } = require('../../utils/response.utils');

// ─── GET /manager/settings ─────────────────────────────────────
const getSettings = async (req, res) => {
  try {
    let result = await pool.query(
      `SELECT * FROM branch_settings WHERE branch_id = $1`,
      [req.branchId]
    );

    if (result.rows.length === 0) {
      const def = await pool.query(
        `INSERT INTO branch_settings (
           branch_id, service_fee_percent, service_fee_enabled,
           vat_percent, vat_enabled, waiter_commission_percent, role_commissions
         ) VALUES ($1, 0, FALSE, 12, FALSE, 0, \'{}\')
         ON CONFLICT (branch_id) DO UPDATE SET branch_id = EXCLUDED.branch_id
         RETURNING *`,
        [req.branchId]
      );
      return success(res, def.rows[0], 'Filial sozlamalari');
    }
    return success(res, result.rows[0], 'Filial sozlamalari');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ─── PUT /manager/settings ─────────────────────────────────────
// Body: { service_fee_percent, service_fee_enabled, vat_percent, vat_enabled,
//         waiter_commission_percent, role_commissions }
const updateSettings = async (req, res) => {
  const {
    service_fee_percent, service_fee_enabled,
    vat_percent, vat_enabled,
    waiter_commission_percent,
    role_commissions,
    telegram_chat_id,
  } = req.body;

  const sfp = service_fee_percent !== undefined ? parseFloat(service_fee_percent) : null;
  const vp  = vat_percent          !== undefined ? parseFloat(vat_percent)         : null;
  const wcp = waiter_commission_percent !== undefined ? parseFloat(waiter_commission_percent) : null;

  if (sfp !== null && (isNaN(sfp) || sfp < 0 || sfp > 100))
    return error(res, "Xizmat haqi 0-100% orasida bo\'lishi kerak");
  if (vp  !== null && (isNaN(vp)  || vp  < 0 || vp  > 100))
    return error(res, "QQS 0-100% orasida bo\'lishi kerak");
  if (wcp !== null && (isNaN(wcp) || wcp < 0 || wcp > 100))
    return error(res, "Komissiya 0-100% orasida bo\'lishi kerak");

  // role_commissions validation: { cashier: 5, cook: 3, ... }
  if (role_commissions !== undefined && typeof role_commissions !== 'object')
    return error(res, "role_commissions object bo\'lishi kerak");

  try {
    const result = await pool.query(
      `INSERT INTO branch_settings (
         branch_id, service_fee_percent, service_fee_enabled,
         vat_percent, vat_enabled, waiter_commission_percent, role_commissions, telegram_chat_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (branch_id) DO UPDATE SET
         service_fee_percent      = COALESCE($2, branch_settings.service_fee_percent),
         service_fee_enabled      = COALESCE($3, branch_settings.service_fee_enabled),
         vat_percent              = COALESCE($4, branch_settings.vat_percent),
         vat_enabled              = COALESCE($5, branch_settings.vat_enabled),
         waiter_commission_percent= COALESCE($6, branch_settings.waiter_commission_percent),
         role_commissions         = COALESCE($7, branch_settings.role_commissions),
         telegram_chat_id         = COALESCE($8, branch_settings.telegram_chat_id),
         updated_at               = NOW()
       RETURNING *`,
      [
        req.branchId,
        sfp,
        service_fee_enabled !== undefined ? service_fee_enabled : null,
        vp,
        vat_enabled !== undefined ? vat_enabled : null,
        wcp,
        role_commissions !== undefined ? JSON.stringify(role_commissions) : null,
        telegram_chat_id !== undefined ? String(telegram_chat_id) : null,
      ]
    );
    return success(res, result.rows[0], 'Sozlamalar yangilandi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ─── GET /manager/waiter-earnings ─────────────────────────────
const getWaiterEarnings = async (req, res) => {
  const { date } = req.query;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return error(res, "Sana YYYY-MM-DD formatida bo\'lishi kerak");
  }
  const targetDate = date || new Date().toISOString().split('T')[0];

  try {
    const result = await pool.query(
      `SELECT
         re.user_id,
         u.full_name as user_name,
         u.role,
         re.date,
         re.total_orders,
         re.total_order_amount,
         re.commission_percent,
         re.earned_amount
       FROM role_earnings re
       JOIN users u ON u.id = re.user_id
       WHERE re.branch_id = $1 AND re.date = $2
       ORDER BY re.earned_amount DESC`,
      [req.branchId, targetDate]
    );

    // Eski waiter_earnings ham qaytarilsin (backward compat)
    const oldResult = await pool.query(
      `SELECT
         we.waiter_id as user_id,
         u.full_name as user_name,
         \'waiter\' as role,
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

    // Merge — role_earnings ni prioritet qilamiz
    const merged = [...result.rows];
    const existingIds = new Set(result.rows.map(r => r.user_id));
    for (const row of oldResult.rows) {
      if (!existingIds.has(row.user_id)) merged.push(row);
    }

    return success(res, merged, `${targetDate} kunlik maosh hisobi`);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = { getSettings, updateSettings, getWaiterEarnings };
