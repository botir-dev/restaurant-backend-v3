const pool = require('../../config/database');
const { success, error, paginate } = require('../../utils/response.utils');

// GET /archive?period=monthly&from=&to=&waiter=&cashier=&table_number=&page=1&limit=20
const getArchive = async (req, res) => {
  const {
    period, from, to,
    waiter, cashier, table_number,
    page = 1, limit = 20
  } = req.query;
  const offset = (page - 1) * limit;

  try {
    let where = `WHERE a.branch_id = $1`;
    const params = [req.branchId];
    let idx = 2;

    // Davr filtri
    if (period === 'daily') {
      where += ` AND DATE(a.created_at) = CURRENT_DATE`;
    } else if (period === 'weekly') {
      where += ` AND a.created_at >= date_trunc('week', NOW())`;
    } else if (period === 'monthly') {
      where += ` AND a.created_at >= date_trunc('month', NOW())`;
    } else if (period === 'yearly') {
      where += ` AND a.created_at >= date_trunc('year', NOW())`;
    }

    // Sana oralig'i
    if (from) { where += ` AND a.created_at >= $${idx++}`; params.push(from); }
    if (to)   { where += ` AND a.created_at <= $${idx++}`; params.push(to); }

    // Ofitsiant (username yoki telefon)
    if (waiter) {
      where += ` AND (a.waiter_name ILIKE $${idx} OR EXISTS (
        SELECT 1 FROM users u WHERE u.id = a.waiter_id AND (u.username ILIKE $${idx} OR u.phone = $${idx+1})
      ))`;
      params.push(`%${waiter}%`, waiter);
      idx += 2;
    }

    // Kassir
    if (cashier) {
      where += ` AND (a.cashier_name ILIKE $${idx} OR EXISTS (
        SELECT 1 FROM users u WHERE u.id = a.cashier_id AND (u.username ILIKE $${idx} OR u.phone = $${idx+1})
      ))`;
      params.push(`%${cashier}%`, cashier);
      idx += 2;
    }

    if (table_number) { where += ` AND a.table_number = $${idx++}`; params.push(table_number); }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM order_archive a ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT a.* FROM order_archive a ${where}
       ORDER BY a.created_at DESC
       LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, limit, offset]
    );

    return paginate(res, result.rows, total, page, limit);
  } catch (err) {
    console.error(err);
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

    if (period === 'daily') {
      where += ` AND DATE(created_at) = CURRENT_DATE`;
    } else if (period === 'weekly') {
      where += ` AND created_at >= date_trunc('week', NOW())`;
    } else if (period === 'monthly') {
      where += ` AND created_at >= date_trunc('month', NOW())`;
    } else if (period === 'yearly') {
      where += ` AND created_at >= date_trunc('year', NOW())`;
    }

    if (from) { where += ` AND created_at >= $${idx++}`; params.push(from); }
    if (to)   { where += ` AND created_at <= $${idx++}`; params.push(to); }

    const result = await pool.query(
      `SELECT
        COUNT(*) as total_orders,
        SUM(total_amount) as total_revenue,
        AVG(total_amount) as avg_order,
        SUM(CASE WHEN payment_type = 'cash' THEN total_amount ELSE 0 END) as cash_revenue,
        SUM(CASE WHEN payment_type = 'card' THEN total_amount ELSE 0 END) as card_revenue,
        SUM(CASE WHEN payment_type = 'qr_payment' THEN total_amount ELSE 0 END) as qr_revenue
       FROM order_archive ${where}`,
      params
    );

    return success(res, result.rows[0], 'Daromad hisobi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = { getArchive, getRevenue };
