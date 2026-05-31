const pool = require('../../config/database');
const { success, error, paginate } = require('../../utils/response.utils');

const VALID_PERIODS = ['daily', 'weekly', 'monthly', 'yearly'];

// GET /archive?period=monthly&from=&to=&waiter=&cashier=&table_number=&page=1&limit=20
const getArchive = async (req, res) => {
  const { period, from, to, waiter, cashier, table_number } = req.query;
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  try {
    let where = `WHERE a.branch_id = $1`;
    const params = [req.branchId];
    let idx = 2;

    if (period && VALID_PERIODS.includes(period)) {
      if (period === 'daily')   where += ` AND DATE(a.created_at) = CURRENT_DATE`;
      if (period === 'weekly')  where += ` AND a.created_at >= date_trunc('week', NOW())`;
      if (period === 'monthly') where += ` AND a.created_at >= date_trunc('month', NOW())`;
      if (period === 'yearly')  where += ` AND a.created_at >= date_trunc('year', NOW())`;
    }

    if (from) {
      const d = new Date(from);
      if (isNaN(d.getTime())) return error(res, "from sanasi noto'g'ri formatda");
      where += ` AND a.created_at >= $${idx++}`;
      params.push(d.toISOString());
    }
    if (to) {
      const d = new Date(to);
      if (isNaN(d.getTime())) return error(res, "to sanasi noto'g'ri formatda");
      where += ` AND a.created_at <= $${idx++}`;
      params.push(d.toISOString());
    }

    if (waiter) {
      where += ` AND (a.waiter_name ILIKE $${idx} OR EXISTS (
        SELECT 1 FROM users u WHERE u.id = a.waiter_id
          AND (u.username ILIKE $${idx} OR u.phone = $${idx + 1})
      ))`;
      params.push(`%${waiter}%`, waiter);
      idx += 2;
    }

    if (cashier) {
      where += ` AND (a.cashier_name ILIKE $${idx} OR EXISTS (
        SELECT 1 FROM users u WHERE u.id = a.cashier_id
          AND (u.username ILIKE $${idx} OR u.phone = $${idx + 1})
      ))`;
      params.push(`%${cashier}%`, cashier);
      idx += 2;
    }

    if (table_number) {
      where += ` AND a.table_number = $${idx++}`;
      params.push(table_number);
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM order_archive a ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT a.* FROM order_archive a ${where}
       ORDER BY a.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return paginate(res, result.rows, total, page, limit);
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

// GET /archive/revenue?period=monthly&from=&to=
const getRevenue = async (req, res) => {
  const { period, from, to } = req.query;
  try {
    let where = `WHERE branch_id = $1`;
    const params = [req.branchId];
    let idx = 2;

    if (period && VALID_PERIODS.includes(period)) {
      if (period === 'daily')   where += ` AND DATE(created_at) = CURRENT_DATE`;
      if (period === 'weekly')  where += ` AND created_at >= date_trunc('week', NOW())`;
      if (period === 'monthly') where += ` AND created_at >= date_trunc('month', NOW())`;
      if (period === 'yearly')  where += ` AND created_at >= date_trunc('year', NOW())`;
    }

    if (from) {
      const d = new Date(from);
      if (isNaN(d.getTime())) return error(res, "from sanasi noto'g'ri formatda");
      where += ` AND created_at >= $${idx++}`;
      params.push(d.toISOString());
    }
    if (to) {
      const d = new Date(to);
      if (isNaN(d.getTime())) return error(res, "to sanasi noto'g'ri formatda");
      where += ` AND created_at <= $${idx++}`;
      params.push(d.toISOString());
    }

    const result = await pool.query(
      `SELECT
         COUNT(*)  as total_orders,
         SUM(total_amount + COALESCE(service_fee_amount,0)) as total_revenue,
         SUM(grand_total) as total_with_vat,
         SUM(COALESCE(vat_amount,0)) as vat_collected,
         AVG(total_amount + COALESCE(service_fee_amount,0)) as avg_order,
         SUM(service_fee_amount) as total_service_fee,
         SUM(CASE WHEN payment_type = 'cash'       THEN total_amount + COALESCE(service_fee_amount,0) ELSE 0 END) as cash_revenue,
         SUM(CASE WHEN payment_type = 'card'       THEN total_amount + COALESCE(service_fee_amount,0) ELSE 0 END) as card_revenue,
         SUM(CASE WHEN payment_type = 'qr_payment' THEN total_amount + COALESCE(service_fee_amount,0) ELSE 0 END) as qr_revenue
       FROM order_archive ${where}`,
      params
    );
    return success(res, result.rows[0], 'Daromad hisobi');
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

// ─── HISOBOTLAR ───────────────────────────────────────────────

// GET /archive/reports/revenue?from=&to=
const getRevenueReport = async (req, res) => {
  const { from, to } = req.query;
  try {
    let where = `WHERE branch_id = $1`;
    const params = [req.branchId];
    let idx = 2;
    if (from) { params.push(new Date(from).toISOString()); where += ` AND created_at >= $${idx++}`; }
    if (to)   { params.push(new Date(to).toISOString());   where += ` AND created_at <= $${idx++}`; }

    const rows = await pool.query(`
      SELECT
        id, order_id, table_number, waiter_name, cashier_name,
        guest_count, total_amount, service_fee_percent,
        service_fee_amount, grand_total, payment_type, is_from_qr,
        TO_CHAR(created_at, 'YYYY-MM-DD') as date,
        TO_CHAR(created_at, 'HH24:MI')    as time,
        created_at, items
      FROM order_archive ${where}
      ORDER BY created_at DESC
    `, params);

    const summary = await pool.query(`
      SELECT
        COUNT(*)                                                          as total_orders,
        SUM(total_amount + COALESCE(service_fee_amount,0))              as total_revenue,
        SUM(COALESCE(vat_amount,0))                                       as vat_collected,
        AVG(total_amount + COALESCE(service_fee_amount,0))              as avg_order,
        SUM(CASE WHEN payment_type='cash'       THEN total_amount + COALESCE(service_fee_amount,0) ELSE 0 END) as cash,
        SUM(CASE WHEN payment_type='card'       THEN total_amount + COALESCE(service_fee_amount,0) ELSE 0 END) as card,
        SUM(CASE WHEN payment_type='qr_payment' THEN total_amount + COALESCE(service_fee_amount,0) ELSE 0 END) as qr
      FROM order_archive ${where}
    `, params);

    return success(res, { rows: rows.rows, summary: summary.rows[0] });
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

// GET /archive/reports/top-products?from=&to=
const getTopProductsReport = async (req, res) => {
  const { from, to } = req.query;
  try {
    let where = `WHERE a.branch_id = $1`;
    const params = [req.branchId];
    let idx = 2;
    if (from) { params.push(new Date(from).toISOString()); where += ` AND a.created_at >= $${idx++}`; }
    if (to)   { params.push(new Date(to).toISOString());   where += ` AND a.created_at <= $${idx++}`; }

    const result = await pool.query(`
      SELECT
        item->>'name'  as name,
        item->>'type'  as type,
        SUM((item->>'quantity')::int) as total_sold,
        SUM((item->>'quantity')::int * (item->>'price')::numeric) as total_revenue,
        COUNT(DISTINCT a.id) as order_count,
        TO_CHAR(
          (AVG(EXTRACT(HOUR FROM a.created_at)*60 + EXTRACT(MINUTE FROM a.created_at))
           * INTERVAL '1 minute'),
          'HH24:MI'
        ) as avg_time
      FROM order_archive a, jsonb_array_elements(a.items) as item
      ${where}
      GROUP BY item->>'name', item->>'type'
      ORDER BY total_sold DESC
    `, params);

    return success(res, result.rows);
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

// GET /archive/reports/last-30-days
const getLast30DaysReport = async (req, res) => {
  try {
    const rows = await pool.query(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as orders,
        SUM(total_amount + COALESCE(service_fee_amount,0)) as revenue,
        SUM(COALESCE(vat_amount,0)) as vat_collected,
        AVG(total_amount + COALESCE(service_fee_amount,0)) as avg_order,
        SUM(CASE WHEN payment_type='cash'       THEN total_amount + COALESCE(service_fee_amount,0) ELSE 0 END) as cash,
        SUM(CASE WHEN payment_type='card'       THEN total_amount + COALESCE(service_fee_amount,0) ELSE 0 END) as card,
        SUM(CASE WHEN payment_type='qr_payment' THEN total_amount + COALESCE(service_fee_amount,0) ELSE 0 END) as qr
      FROM order_archive
      WHERE branch_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `, [req.branchId]);

    const total = await pool.query(`
      SELECT COUNT(*) as orders, SUM(total_amount + COALESCE(service_fee_amount,0)) as revenue
      FROM order_archive
      WHERE branch_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
    `, [req.branchId]);

    return success(res, { rows: rows.rows, total: total.rows[0] });
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

// GET /archive/reports/waiter-salary?from=&to=
const getWaiterSalaryReport = async (req, res) => {
  const { from, to } = req.query;
  try {
    let where = `WHERE oa.branch_id = $1`;
    const params = [req.branchId];
    let idx = 2;
    if (from) { params.push(new Date(from).toISOString()); where += ` AND oa.created_at >= $${idx++}`; }
    if (to)   { params.push(new Date(to).toISOString());   where += ` AND oa.created_at <= $${idx++}`; }

    const rows = await pool.query(`
      SELECT
        oa.waiter_id, oa.waiter_name,
        DATE(oa.created_at) as date,
        COUNT(*) as orders,
        SUM(oa.total_amount) as orders_total,
        MAX(we.commission_percent) as commission_percent,
        COALESCE(MAX(we.earned_amount), 0) as earned
      FROM order_archive oa
      LEFT JOIN waiter_earnings we
        ON we.waiter_id = oa.waiter_id
       AND we.date = DATE(oa.created_at)
       AND we.branch_id = oa.branch_id
      ${where}
      GROUP BY oa.waiter_id, oa.waiter_name, DATE(oa.created_at)
      ORDER BY oa.waiter_name, date DESC
    `, params);

    const summary = await pool.query(`
      SELECT
        oa.waiter_id, oa.waiter_name,
        COUNT(*) as total_orders,
        SUM(oa.total_amount) as total_orders_amount,
        SUM(COALESCE(we.earned_amount, 0)) as total_earned
      FROM order_archive oa
      LEFT JOIN waiter_earnings we
        ON we.waiter_id = oa.waiter_id
       AND we.date = DATE(oa.created_at)
       AND we.branch_id = oa.branch_id
      ${where}
      GROUP BY oa.waiter_id, oa.waiter_name
      ORDER BY total_earned DESC
    `, params);

    return success(res, { rows: rows.rows, summary: summary.rows });
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

// GET /archive/reports/top-waiters?from=&to=
const getTopWaitersReport = async (req, res) => {
  const { from, to } = req.query;
  try {
    let where = `WHERE branch_id = $1`;
    const params = [req.branchId];
    let idx = 2;
    if (from) { params.push(new Date(from).toISOString()); where += ` AND created_at >= $${idx++}`; }
    if (to)   { params.push(new Date(to).toISOString());   where += ` AND created_at <= $${idx++}`; }

    const result = await pool.query(`
      SELECT
        waiter_id, waiter_name,
        COUNT(*) as total_orders,
        SUM(total_amount + COALESCE(service_fee_amount,0)) as total_revenue,
        AVG(total_amount + COALESCE(service_fee_amount,0)) as avg_order,
        COUNT(DISTINCT DATE(created_at)) as working_days
      FROM order_archive ${where}
      GROUP BY waiter_id, waiter_name
      ORDER BY total_orders DESC
    `, params);

    return success(res, result.rows);
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

// GET /archive/reports/order-history?from=&to=
const getOrderHistoryReport = async (req, res) => {
  const { from, to } = req.query;
  try {
    let where = `WHERE branch_id = $1`;
    const params = [req.branchId];
    let idx = 2;
    if (from) { params.push(new Date(from).toISOString()); where += ` AND created_at >= $${idx++}`; }
    if (to)   { params.push(new Date(to).toISOString());   where += ` AND created_at <= $${idx++}`; }

    const result = await pool.query(`
      SELECT
        order_id, table_number, waiter_name, cashier_name,
        guest_count, items, total_amount, service_fee_percent,
        service_fee_amount, grand_total, payment_type, is_from_qr,
        TO_CHAR(created_at, 'YYYY-MM-DD') as date,
        TO_CHAR(created_at, 'HH24:MI')    as time,
        created_at
      FROM order_archive ${where}
      ORDER BY created_at DESC
    `, params);

    return success(res, result.rows);
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

// GET /archive/reports/top-tables?from=&to=
const getTopTablesReport = async (req, res) => {
  const { from, to } = req.query;
  try {
    let where = `WHERE branch_id = $1`;
    const params = [req.branchId];
    let idx = 2;
    if (from) { params.push(new Date(from).toISOString()); where += ` AND created_at >= $${idx++}`; }
    if (to)   { params.push(new Date(to).toISOString());   where += ` AND created_at <= $${idx++}`; }

    const result = await pool.query(`
      SELECT
        table_number,
        COUNT(*) as total_orders,
        SUM(total_amount + COALESCE(service_fee_amount,0)) as total_revenue,
        AVG(total_amount + COALESCE(service_fee_amount,0)) as avg_order,
        COUNT(DISTINCT DATE(created_at)) as active_days
      FROM order_archive ${where}
      GROUP BY table_number
      ORDER BY total_orders DESC
    `, params);

    const allTables = await pool.query(
      `SELECT table_number FROM tables WHERE branch_id = $1 ORDER BY table_number`,
      [req.branchId]
    );

    const used = new Set(result.rows.map(r => String(r.table_number)));
    const zeros = allTables.rows
      .filter(t => !used.has(String(t.table_number)))
      .map(t => ({
        table_number: t.table_number,
        total_orders: 0, total_revenue: 0, avg_order: 0, active_days: 0,
      }));

    return success(res, [...result.rows, ...zeros]);
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = {
  getArchive, getRevenue,
  getRevenueReport, getTopProductsReport, getLast30DaysReport,
  getWaiterSalaryReport, getTopWaitersReport,
  getOrderHistoryReport, getTopTablesReport,
};
