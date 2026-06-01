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



// ─── YANGI HISOBOTLAR ─────────────────────────────────────────

// GET /archive/reports/product-history?from=&to=
const getProductHistoryReport = async (req, res) => {
  const { from, to } = req.query;
  try {
    // change_amount > 0: faqat omborga KIRUVCHI mahsulotlar (manual_add, adjustment)
    // reason = 'order' bo'lsa buyurtma uchun CHIQARISH - uni hisobga olmaymiz
    // Barcha kiruvchi (musbat) loglar - manual_add va boshqa sabab bo'lsa ham
    let where = `WHERE l.branch_id = $1 AND l.change_amount > 0`;
    const params = [req.branchId];
    let idx = 2;
    // ::date cast bilan timezone muammosidan qochamiz
    if (from) { params.push(from); where += ` AND l.created_at::date >= $${idx++}::date`; }
    if (to)   { params.push(to);   where += ` AND l.created_at::date <= $${idx++}::date`; }

    const rows = await pool.query(`
      SELECT
        l.id,
        i.name                                     AS product_name,
        i.unit,
        i.custom_unit,
        l.change_amount                            AS quantity,
        i.cost_price                               AS unit_cost,
        ROUND(l.change_amount * COALESCE(i.cost_price, 0), 2) AS total_cost,
        l.reason,
        TO_CHAR(l.created_at, 'YYYY-MM-DD')        AS date,
        TO_CHAR(l.created_at, 'HH24:MI')           AS time,
        l.created_at
      FROM inventory_logs l
      JOIN inventory_items i ON i.id = l.inventory_item_id
      ${where}
      ORDER BY l.created_at DESC
    `, params);

    // Mahsulot bo'yicha umumiy xulosa
    const summary = await pool.query(`
      SELECT
        i.name                                             AS product_name,
        i.unit,
        i.custom_unit,
        i.cost_price                                       AS unit_cost,
        SUM(l.change_amount)                               AS total_quantity,
        ROUND(SUM(l.change_amount * COALESCE(i.cost_price, 0)), 2) AS total_cost
      FROM inventory_logs l
      JOIN inventory_items i ON i.id = l.inventory_item_id
      ${where}
      GROUP BY i.name, i.unit, i.custom_unit, i.cost_price
      ORDER BY total_cost DESC
    `, params);

    const grandTotal = summary.rows.reduce((s, r) => s + parseFloat(r.total_cost || 0), 0);

    return success(res, { rows: rows.rows, summary: summary.rows, grand_total: grandTotal });
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// GET /archive/reports/expenses-30?electricity=&water=&gas=
const getExpenses30Report = async (req, res) => {
  const electricity = parseFloat(req.query.electricity) || 0;
  const water       = parseFloat(req.query.water)       || 0;
  const gas         = parseFloat(req.query.gas)         || 0;

  try {
    const branchId = req.branchId;
    // DATE formatda ishlash - timezone muammosidan qochish
    const nowDate  = new Date();
    const toDate   = nowDate.toISOString().split('T')[0];
    const fromDate = new Date(nowDate - 30*24*60*60*1000).toISOString().split('T')[0];

    // ── 1. Ombor harajatlari (kiruvchi mahsulotlar) ───────────
    // reason = 'manual_add' -> faqat qo'lda qo'shilganlar
    // change_amount > 0 -> musbat miqdor
    const inventoryRows = await pool.query(`
      SELECT
        i.name                                              AS product_name,
        i.unit,
        i.custom_unit,
        i.cost_price                                        AS unit_cost,
        SUM(l.change_amount)                                AS total_quantity,
        ROUND(SUM(l.change_amount * COALESCE(i.cost_price,0)), 2) AS total_cost
      FROM inventory_logs l
      JOIN inventory_items i ON i.id = l.inventory_item_id
      WHERE l.branch_id = $1
        AND l.change_amount > 0
        AND l.created_at::date >= $2::date
        AND l.created_at::date <= $3::date
      GROUP BY i.name, i.unit, i.custom_unit, i.cost_price
      ORDER BY total_cost DESC
    `, [branchId, fromDate, toDate]);

    const totalInventory = inventoryRows.rows.reduce((s, r) => s + parseFloat(r.total_cost || 0), 0);

    // ── 2. Hodimlar maoshi ────────────────────────────────────
    // a) commission (foiz) asosida maosh
    // waiter_earnings jadvali mavjud bo'lmasa xato bermaydi
    let commissionStaff = { rows: [] };
    try {
      commissionStaff = await pool.query(`
        SELECT
          u.full_name,
          u.role,
          u.use_commission,
          u.monthly_salary,
          SUM(COALESCE(we.earned_amount, 0)) AS earned
        FROM users u
        LEFT JOIN waiter_earnings we
          ON we.waiter_id = u.id
         AND we.branch_id = u.branch_id
         AND we.date >= $2::date
         AND we.date <= $3::date
        WHERE u.branch_id = $1
          AND u.is_active = TRUE
          AND u.use_commission = TRUE
          AND u.role NOT IN ('super_admin')
        GROUP BY u.id, u.full_name, u.role, u.use_commission, u.monthly_salary
        ORDER BY u.full_name
      `, [branchId, fromDate, toDate]);
    } catch (e) {
      console.warn('waiter_earnings query error (jadval yo\'q bo\'lishi mumkin):', e.message);
    }

    // b) Oylik maosh birikadirilganlar
    const monthlySalaryStaff = await pool.query(`
      SELECT
        u.full_name,
        u.role,
        u.monthly_salary,
        u.use_commission
      FROM users u
      WHERE u.branch_id = $1
        AND u.is_active = TRUE
        AND u.monthly_salary IS NOT NULL
        AND u.monthly_salary > 0
        AND (u.use_commission IS NULL OR u.use_commission = FALSE)
        AND u.role NOT IN ('super_admin')
      ORDER BY u.full_name
    `, [branchId]);

    const totalCommission = commissionStaff.rows.reduce((s, r) => s + parseFloat(r.earned || 0), 0);
    const totalMonthly    = monthlySalaryStaff.rows.reduce((s, r) => s + parseFloat(r.monthly_salary || 0), 0);
    const totalSalary     = totalCommission + totalMonthly;

    // ── 3. Buyurtmalar statistikasi ───────────────────────────
    const ordersRes = await pool.query(`
      SELECT
        COUNT(*)                                                    AS total_orders,
        SUM(total_amount + COALESCE(service_fee_amount, 0))        AS total_revenue,
        SUM(COALESCE(vat_amount, 0))                               AS total_vat
      FROM order_archive
      WHERE branch_id = $1
        AND created_at::date >= $2::date
        AND created_at::date <= $3::date
    `, [branchId, fromDate, toDate]);

    const ordersData = ordersRes.rows[0];
    const totalRevenue = parseFloat(ordersData.total_revenue || 0);
    const totalVat     = parseFloat(ordersData.total_vat || 0);

    // QQS 12% hisoblash (agar vat_amount yo'q bo'lsa daromaddan 12% hisoblaymiz)
    const vatAmount = totalVat > 0 ? totalVat : Math.round(totalRevenue * 0.12);

    // ── 4. Umumiy harajat ─────────────────────────────────────
    const totalUtilities = electricity + water + gas;
    const totalExpenses  = vatAmount + totalUtilities + totalSalary + totalInventory;

    return success(res, {
      period: { from: fromDate, to: toDate },
      inventory: { rows: inventoryRows.rows, total: totalInventory },
      salary: {
        commission_staff: commissionStaff.rows,
        monthly_staff: monthlySalaryStaff.rows,
        total_commission: totalCommission,
        total_monthly: totalMonthly,
        total: totalSalary,
      },
      utilities: { electricity, water, gas, total: totalUtilities },
      orders: {
        total_orders: parseInt(ordersData.total_orders || 0),
        total_revenue: totalRevenue,
        vat_amount: vatAmount,
      },
      grand_total: totalExpenses,
    });
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// GET /archive/reports/delivery?from=&to=
const getDeliveryReport = async (req, res) => {
  const { from, to } = req.query;
  try {
    let where = `WHERE branch_id = $1 AND order_type = 'delivery'`;
    const params = [req.branchId];
    let idx = 2;
    if (from) { params.push(new Date(from).toISOString()); where += ` AND created_at >= $${idx++}`; }
    if (to)   { params.push(new Date(to).toISOString());   where += ` AND created_at <= $${idx++}`; }

    const rows = await pool.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM-DD') AS date,
        TO_CHAR(created_at, 'HH24:MI')    AS time,
        order_id,
        waiter_name,
        cashier_name,
        items,
        total_amount,
        service_fee_amount,
        grand_total,
        payment_type,
        created_at
      FROM order_archive ${where}
      ORDER BY created_at DESC
    `, params);

    const daily = await pool.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM-DD') AS date,
        COUNT(*)                           AS order_count,
        SUM(jsonb_array_length(items))     AS item_count,
        SUM(grand_total)                   AS revenue
      FROM order_archive ${where}
      GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD')
      ORDER BY date DESC
    `, params);

    const summary = await pool.query(`
      SELECT
        COUNT(*)                        AS total_orders,
        SUM(jsonb_array_length(items))  AS total_items,
        SUM(grand_total)                AS total_revenue
      FROM order_archive ${where}
    `, params);

    return success(res, {
      rows: rows.rows,
      daily: daily.rows,
      summary: summary.rows[0],
    });
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// GET /archive/reports/takeaway?from=&to=
const getTakeawayReport = async (req, res) => {
  const { from, to } = req.query;
  try {
    let where = `WHERE branch_id = $1 AND order_type = 'takeaway'`;
    const params = [req.branchId];
    let idx = 2;
    if (from) { params.push(new Date(from).toISOString()); where += ` AND created_at >= $${idx++}`; }
    if (to)   { params.push(new Date(to).toISOString());   where += ` AND created_at <= $${idx++}`; }

    const rows = await pool.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM-DD') AS date,
        TO_CHAR(created_at, 'HH24:MI')    AS time,
        order_id,
        waiter_name,
        cashier_name,
        items,
        total_amount,
        service_fee_amount,
        grand_total,
        payment_type,
        created_at
      FROM order_archive ${where}
      ORDER BY created_at DESC
    `, params);

    const daily = await pool.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM-DD') AS date,
        COUNT(*)                           AS order_count,
        SUM(jsonb_array_length(items))     AS item_count,
        SUM(grand_total)                   AS revenue
      FROM order_archive ${where}
      GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD')
      ORDER BY date DESC
    `, params);

    const summary = await pool.query(`
      SELECT
        COUNT(*)                        AS total_orders,
        SUM(jsonb_array_length(items))  AS total_items,
        SUM(grand_total)                AS total_revenue
      FROM order_archive ${where}
    `, params);

    return success(res, {
      rows: rows.rows,
      daily: daily.rows,
      summary: summary.rows[0],
    });
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// GET /archive/reports/last-30-days-extended
// Oxirgi 30 kun + oldingi 30 kun solishtirish, haftalik, yillik
const getLast30DaysExtended = async (req, res) => {
  try {
    const branchId = req.branchId;
    const now = new Date();

    const cur_to   = now.toISOString();
    const cur_from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const prev_to  = cur_from;
    const prev_from = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();

    // Joriy 30 kun
    const curPeriod = await pool.query(`
      SELECT COUNT(*) AS orders, SUM(grand_total) AS revenue
      FROM order_archive
      WHERE branch_id = $1 AND created_at >= $2 AND created_at < $3
    `, [branchId, cur_from, cur_to]);

    // O'tgan 30 kun
    const prevPeriod = await pool.query(`
      SELECT COUNT(*) AS orders, SUM(grand_total) AS revenue
      FROM order_archive
      WHERE branch_id = $1 AND created_at >= $2 AND created_at < $3
    `, [branchId, prev_from, prev_to]);

    // Haftalik solishtirish (4 hafta)
    const weeklyRows = await pool.query(`
      SELECT
        DATE_TRUNC('week', created_at) AS week_start,
        COUNT(*)                        AS orders,
        SUM(grand_total)                AS revenue
      FROM order_archive
      WHERE branch_id = $1 AND created_at >= $2
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week_start DESC
      LIMIT 8
    `, [branchId, prev_from]);

    // Oylik solishtirish (12 oy)
    const monthlyRows = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COUNT(*)                                             AS orders,
        SUM(grand_total)                                     AS revenue
      FROM order_archive
      WHERE branch_id = $1 AND created_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month DESC
    `, [branchId]);

    // Yillik solishtirish (3 yil)
    const yearlyRows = await pool.query(`
      SELECT
        EXTRACT(YEAR FROM created_at)::int AS year,
        COUNT(*)                           AS orders,
        SUM(grand_total)                   AS revenue
      FROM order_archive
      WHERE branch_id = $1
      GROUP BY EXTRACT(YEAR FROM created_at)
      ORDER BY year DESC
      LIMIT 3
    `, [branchId]);

    const cur  = curPeriod.rows[0];
    const prev = prevPeriod.rows[0];
    const curOrders  = parseInt(cur.orders  || 0);
    const prevOrders = parseInt(prev.orders || 0);
    const curRev     = parseFloat(cur.revenue  || 0);
    const prevRev    = parseFloat(prev.revenue || 0);

    const orderGrowth  = prevOrders > 0 ? Math.round(((curOrders - prevOrders) / prevOrders) * 100) : null;
    const revenueGrowth = prevRev   > 0 ? Math.round(((curRev - prevRev) / prevRev) * 100)          : null;

    return success(res, {
      current_30:  { orders: curOrders,  revenue: curRev,  from: cur_from, to: cur_to },
      previous_30: { orders: prevOrders, revenue: prevRev, from: prev_from, to: prev_to },
      order_growth_pct:   orderGrowth,
      revenue_growth_pct: revenueGrowth,
      weekly:  weeklyRows.rows,
      monthly: monthlyRows.rows,
      yearly:  yearlyRows.rows,
    });
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = {
  getArchive, getRevenue,
  getRevenueReport, getTopProductsReport, getLast30DaysReport,
  getWaiterSalaryReport, getTopWaitersReport,
  getOrderHistoryReport, getTopTablesReport,
  getProductHistoryReport, getExpenses30Report,
  getDeliveryReport, getTakeawayReport, getLast30DaysExtended,
};
