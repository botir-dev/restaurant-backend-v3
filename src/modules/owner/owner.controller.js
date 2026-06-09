const pool = require('../../config/database');
const { success, error, paginate } = require('../../utils/response.utils');

// ─── Yordamchi: owner o'z restoraning branch_id larini tekshiradi ─
const verifyBranchOwnership = async (branchId, restaurantId) => {
  const r = await pool.query(
    `SELECT id FROM branches WHERE id = $1 AND restaurant_id = $2`,
    [branchId, restaurantId]
  );
  return r.rows.length > 0;
};

// ─────────────────────────────────────────────────────────────
// GET /owner/dashboard
// Barcha filiallar umumiy ko'rinishi (karta)
// ─────────────────────────────────────────────────────────────
const getDashboard = async (req, res) => {
  const restaurantId = req.user.restaurant_id;
  try {
    // Filiallar
    const branchesRes = await pool.query(
      `SELECT b.id, b.name, b.address, b.phone,
              COUNT(DISTINCT u.id) FILTER (WHERE u.is_active AND u.role != 'owner') AS staff_count
       FROM branches b
       LEFT JOIN users u ON u.branch_id = b.id
       WHERE b.restaurant_id = $1
       GROUP BY b.id ORDER BY b.name`,
      [restaurantId]
    );
    const branches = branchesRes.rows;

    // Har bir filial uchun bugungi daromad
    const today = new Date().toISOString().split('T')[0];
    const revenueRes = await pool.query(
      `SELECT oa.branch_id,
              SUM(oa.total_amount + COALESCE(oa.service_fee_amount,0)) AS today_revenue,
              COUNT(*) AS today_orders
       FROM order_archive oa
       JOIN branches b ON b.id = oa.branch_id
       WHERE b.restaurant_id = $1
         AND oa.created_at::date = $2::date
       GROUP BY oa.branch_id`,
      [restaurantId, today]
    );
    const revenueMap = {};
    revenueRes.rows.forEach(r => {
      revenueMap[r.branch_id] = {
        today_revenue: parseFloat(r.today_revenue || 0),
        today_orders:  parseInt(r.today_orders || 0),
      };
    });

    // Oylik daromad (joriy oy)
    const monthStart = `${today.substring(0,7)}-01`;
    const monthRevenueRes = await pool.query(
      `SELECT oa.branch_id,
              SUM(oa.total_amount + COALESCE(oa.service_fee_amount,0)) AS month_revenue
       FROM order_archive oa
       JOIN branches b ON b.id = oa.branch_id
       WHERE b.restaurant_id = $1
         AND oa.created_at::date >= $2::date
       GROUP BY oa.branch_id`,
      [restaurantId, monthStart]
    );
    const monthMap = {};
    monthRevenueRes.rows.forEach(r => {
      monthMap[r.branch_id] = parseFloat(r.month_revenue || 0);
    });

    const result = branches.map(b => ({
      ...b,
      today_revenue: revenueMap[b.id]?.today_revenue || 0,
      today_orders:  revenueMap[b.id]?.today_orders  || 0,
      month_revenue: monthMap[b.id] || 0,
    }));

    const totalToday = result.reduce((s, b) => s + b.today_revenue, 0);
    const totalMonth = result.reduce((s, b) => s + b.month_revenue, 0);

    return success(res, {
      restaurant_id: restaurantId,
      branches: result,
      totals: { today: totalToday, month: totalMonth, branch_count: branches.length },
    });
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /owner/branches/compare?from=&to=
// Filiallarni daromad bo'yicha solishtirish
// ─────────────────────────────────────────────────────────────
const compareBranches = async (req, res) => {
  const restaurantId = req.user.restaurant_id;
  const today = new Date().toISOString().split('T')[0];
  const from  = req.query.from || `${today.substring(0,7)}-01`;
  const to    = req.query.to   || today;

  try {
    const res1 = await pool.query(
      `SELECT
         b.id, b.name,
         SUM(oa.total_amount + COALESCE(oa.service_fee_amount,0)) AS revenue,
         COUNT(oa.id)                                              AS orders,
         AVG(oa.total_amount)                                      AS avg_order,
         COUNT(DISTINCT u.id) FILTER (WHERE u.is_active AND u.role NOT IN ('owner','manager')) AS staff_count
       FROM branches b
       LEFT JOIN order_archive oa ON oa.branch_id = b.id
         AND oa.created_at::date >= $2::date
         AND oa.created_at::date <= $3::date
       LEFT JOIN users u ON u.branch_id = b.id
       WHERE b.restaurant_id = $1
       GROUP BY b.id ORDER BY revenue DESC NULLS LAST`,
      [restaurantId, from, to]
    );

    // Top mahsulotlar har filial uchun
    const topRes = await pool.query(
      `SELECT
         oa.branch_id,
         item->>'name'          AS product_name,
         SUM((item->>'quantity')::int) AS total_qty
       FROM order_archive oa,
            jsonb_array_elements(oa.items::jsonb) AS item
       JOIN branches b ON b.id = oa.branch_id
       WHERE b.restaurant_id = $1
         AND oa.created_at::date >= $2::date
         AND oa.created_at::date <= $3::date
       GROUP BY oa.branch_id, item->>'name'
       ORDER BY oa.branch_id, total_qty DESC`,
      [restaurantId, from, to]
    );

    // Har filial uchun top 3 mahsulot
    const topMap = {};
    topRes.rows.forEach(r => {
      if (!topMap[r.branch_id]) topMap[r.branch_id] = [];
      if (topMap[r.branch_id].length < 3) topMap[r.branch_id].push(r);
    });

    const branches = res1.rows.map(b => ({
      ...b,
      revenue:   parseFloat(b.revenue || 0),
      avg_order: parseFloat(b.avg_order || 0),
      top_products: topMap[b.id] || [],
    }));

    return success(res, { from, to, branches });
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /owner/branches/:branchId/revenue?from=&to=&period=daily|monthly
// Bitta filial daromad grafigi
// ─────────────────────────────────────────────────────────────
const getBranchRevenue = async (req, res) => {
  const restaurantId = req.user.restaurant_id;
  const { branchId } = req.params;
  const today  = new Date().toISOString().split('T')[0];
  const from   = req.query.from   || `${today.substring(0,7)}-01`;
  const to     = req.query.to     || today;
  const period = req.query.period || 'daily';

  if (!(await verifyBranchOwnership(branchId, restaurantId)))
    return error(res, 'Bu filial sizga tegishli emas', 403);

  try {
    const format = period === 'monthly' ? 'YYYY-MM' : 'YYYY-MM-DD';
    const r = await pool.query(
      `SELECT
         TO_CHAR(created_at, '${format}') AS period,
         SUM(total_amount + COALESCE(service_fee_amount,0)) AS revenue,
         COUNT(*) AS orders
       FROM order_archive
       WHERE branch_id = $1
         AND created_at::date >= $2::date
         AND created_at::date <= $3::date
       GROUP BY TO_CHAR(created_at, '${format}')
       ORDER BY period`,
      [branchId, from, to]
    );
    return success(res, { branch_id: branchId, from, to, period, data: r.rows });
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /owner/branches/:branchId/inventory
// Bitta filial ombori (faqat ko'rish)
// ─────────────────────────────────────────────────────────────
const getBranchInventory = async (req, res) => {
  const restaurantId = req.user.restaurant_id;
  const { branchId } = req.params;

  if (!(await verifyBranchOwnership(branchId, restaurantId)))
    return error(res, 'Bu filial sizga tegishli emas', 403);

  try {
    const r = await pool.query(
      `SELECT id, name, quantity, unit, custom_unit, min_quantity, cost_price, updated_at
       FROM inventory_items
       WHERE branch_id = $1
       ORDER BY name`,
      [branchId]
    );

    // Min qoldiq ostidagi mahsulotlar
    const lowStock = r.rows.filter(
      i => i.min_quantity && parseFloat(i.quantity) <= parseFloat(i.min_quantity)
    );

    return success(res, {
      branch_id: branchId,
      items: r.rows,
      low_stock_count: lowStock.length,
      low_stock: lowStock,
    });
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /owner/inventory/compare
// Barcha filiallar ombori solishtirish
// ─────────────────────────────────────────────────────────────
const compareInventory = async (req, res) => {
  const restaurantId = req.user.restaurant_id;
  try {
    const r = await pool.query(
      `SELECT
         b.id AS branch_id, b.name AS branch_name,
         COUNT(i.id)                                                   AS item_count,
         COUNT(i.id) FILTER (WHERE i.min_quantity IS NOT NULL
                               AND i.quantity <= i.min_quantity)       AS low_stock_count,
         SUM(i.quantity * COALESCE(i.cost_price, 0))                   AS total_value
       FROM branches b
       LEFT JOIN inventory_items i ON i.branch_id = b.id
       WHERE b.restaurant_id = $1
       GROUP BY b.id ORDER BY b.name`,
      [restaurantId]
    );
    return success(res, r.rows);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /owner/branches/:branchId/reports/expenses?from=&to=
// Bitta filial harajat hisoboti (faqat ko'rish)
// ─────────────────────────────────────────────────────────────
const getBranchExpenses = async (req, res) => {
  const restaurantId = req.user.restaurant_id;
  const { branchId } = req.params;
  const today = new Date().toISOString().split('T')[0];
  const from  = req.query.from || `${today.substring(0,7)}-01`;
  const to    = req.query.to   || today;

  if (!(await verifyBranchOwnership(branchId, restaurantId)))
    return error(res, 'Bu filial sizga tegishli emas', 403);

  try {
    // Ombor harajati
    const invRes = await pool.query(
      `SELECT i.name, ABS(SUM(l.change_amount)) AS used, i.unit, i.custom_unit,
              ABS(SUM(l.change_amount)) * COALESCE(MAX(i.cost_price),0) AS cost
       FROM inventory_logs l
       JOIN inventory_items i ON i.id = l.inventory_item_id
       WHERE l.branch_id = $1 AND l.change_amount < 0
         AND l.reason = 'order'
         AND l.created_at::date >= $2::date
         AND l.created_at::date <= $3::date
       GROUP BY i.id, i.name, i.unit, i.custom_unit
       ORDER BY cost DESC`,
      [branchId, from, to]
    );

    // Staff meal harajati
    const smRes = await pool.query(
      `SELECT sm.menu_item_name, SUM(sm.quantity) AS portions
       FROM staff_meals sm
       WHERE sm.branch_id = $1
         AND sm.created_at::date >= $2::date AND sm.created_at::date <= $3::date
       GROUP BY sm.menu_item_name ORDER BY portions DESC`,
      [branchId, from, to]
    );
    const smCostRes = await pool.query(
      `SELECT ABS(SUM(l.change_amount * COALESCE(i.cost_price,0))) AS total_cost
       FROM inventory_logs l JOIN inventory_items i ON i.id = l.inventory_item_id
       WHERE l.branch_id = $1 AND l.reason = 'staff_meal'
         AND l.created_at::date >= $2::date AND l.created_at::date <= $3::date`,
      [branchId, from, to]
    );

    // Daromad
    const revRes = await pool.query(
      `SELECT SUM(total_amount + COALESCE(service_fee_amount,0)) AS revenue,
              COUNT(*) AS orders
       FROM order_archive
       WHERE branch_id = $1
         AND created_at::date >= $2::date AND created_at::date <= $3::date`,
      [branchId, from, to]
    );

    const revenue          = parseFloat(revRes.rows[0]?.revenue || 0);
    const inventoryCost    = invRes.rows.reduce((s, r) => s + parseFloat(r.cost || 0), 0);
    const staffMealCost    = parseFloat(smCostRes.rows[0]?.total_cost || 0);

    return success(res, {
      branch_id: branchId, from, to,
      revenue,
      orders: parseInt(revRes.rows[0]?.orders || 0),
      inventory: { items: invRes.rows, total: inventoryCost },
      staff_meals: { items: smRes.rows, total: staffMealCost },
      total_expenses: inventoryCost + staffMealCost,
      profit_estimate: revenue - inventoryCost - staffMealCost,
    });
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /owner/branches/:branchId/staff
// Bitta filial xodimlari (faqat ko'rish)
// ─────────────────────────────────────────────────────────────
const getBranchStaff = async (req, res) => {
  const restaurantId = req.user.restaurant_id;
  const { branchId } = req.params;

  if (!(await verifyBranchOwnership(branchId, restaurantId)))
    return error(res, 'Bu filial sizga tegishli emas', 403);

  try {
    const r = await pool.query(
      `SELECT id, full_name, username, role, phone, is_active, created_at
       FROM users
       WHERE branch_id = $1 AND role != 'owner'
       ORDER BY role, full_name`,
      [branchId]
    );
    return success(res, r.rows);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /owner/branches/:branchId/staff-meals?from=&to=
// Bitta filial staff meal hisoboti
// ─────────────────────────────────────────────────────────────
const getBranchStaffMeals = async (req, res) => {
  const restaurantId = req.user.restaurant_id;
  const { branchId } = req.params;
  const today = new Date().toISOString().split('T')[0];
  const from  = req.query.from || `${today.substring(0,7)}-01`;
  const to    = req.query.to   || today;

  if (!(await verifyBranchOwnership(branchId, restaurantId)))
    return error(res, 'Bu filial sizga tegishli emas', 403);

  try {
    const r = await pool.query(
      `SELECT menu_item_name, SUM(quantity) AS total_qty, COUNT(*) AS records
       FROM staff_meals
       WHERE branch_id = $1
         AND created_at::date >= $2::date AND created_at::date <= $3::date
       GROUP BY menu_item_name ORDER BY total_qty DESC`,
      [branchId, from, to]
    );
    const total = r.rows.reduce((s, x) => s + parseInt(x.total_qty), 0);
    return success(res, { from, to, by_dish: r.rows, total_portions: total });
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /owner/branches/:branchId/menu
// Bitta filial menyusi (faqat ko'rish)
// ─────────────────────────────────────────────────────────────
const getBranchMenu = async (req, res) => {
  const restaurantId = req.user.restaurant_id;
  const { branchId } = req.params;

  if (!(await verifyBranchOwnership(branchId, restaurantId)))
    return error(res, 'Bu filial sizga tegishli emas', 403);

  try {
    const r = await pool.query(
      `SELECT id, name, price, type, is_available, image_url
       FROM menu_items WHERE branch_id = $1 ORDER BY type, name`,
      [branchId]
    );
    return success(res, r.rows);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /owner/branches/:branchId/archive?from=&to=&page=&limit=
// Bitta filial arxivi (faqat ko'rish)
// ─────────────────────────────────────────────────────────────
const getBranchArchive = async (req, res) => {
  const restaurantId = req.user.restaurant_id;
  const { branchId } = req.params;
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 30);
  const offset = (page - 1) * limit;

  if (!(await verifyBranchOwnership(branchId, restaurantId)))
    return error(res, 'Bu filial sizga tegishli emas', 403);

  try {
    let where = `WHERE oa.branch_id = $1`;
    const params = [branchId];
    let idx = 2;
    if (req.query.from) { where += ` AND oa.created_at::date >= $${idx++}::date`; params.push(req.query.from); }
    if (req.query.to)   { where += ` AND oa.created_at::date <= $${idx++}::date`; params.push(req.query.to); }

    const countRes = await pool.query(`SELECT COUNT(*) FROM order_archive oa ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const r = await pool.query(
      `SELECT oa.id, oa.order_number, oa.total_amount, oa.service_fee_amount,
              oa.order_type, oa.table_number, oa.created_at,
              oa.waiter_name, oa.cashier_name
       FROM order_archive oa ${where}
       ORDER BY oa.created_at DESC
       LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, limit, offset]
    );

    return paginate(res, r.rows, total, page, limit);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ─────────────────────────────────────────────────────────────
// PUT /owner/branches/:branchId
// Filial nomi va manzilini o'zgartirish (FAQAT shu ikki maydon)
// ─────────────────────────────────────────────────────────────
const updateBranch = async (req, res) => {
  const restaurantId = req.user.restaurant_id;
  const { branchId } = req.params;
  const { name, address } = req.body;

  if (!name && !address)
    return error(res, 'Nom yoki manzil kiriting');

  if (!(await verifyBranchOwnership(branchId, restaurantId)))
    return error(res, 'Bu filial sizga tegishli emas', 403);

  try {
    const r = await pool.query(
      `UPDATE branches
       SET name    = COALESCE($1, name),
           address = COALESCE($2, address),
           updated_at = NOW()
       WHERE id = $3 AND restaurant_id = $4
       RETURNING id, name, address, phone`,
      [name || null, address || null, branchId, restaurantId]
    );
    if (r.rows.length === 0) return error(res, 'Filial topilmadi', 404);
    return success(res, r.rows[0], 'Filial yangilandi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /owner/reports/global?from=&to=
// Barcha filiallar umumiy hisobot
// ─────────────────────────────────────────────────────────────
const getGlobalReport = async (req, res) => {
  const restaurantId = req.user.restaurant_id;
  const today = new Date().toISOString().split('T')[0];
  const from  = req.query.from || `${today.substring(0,7)}-01`;
  const to    = req.query.to   || today;

  try {
    // Kunlik daromad (barcha filiallar yig'indisi)
    const dailyRes = await pool.query(
      `SELECT
         TO_CHAR(oa.created_at,'YYYY-MM-DD') AS date,
         SUM(oa.total_amount + COALESCE(oa.service_fee_amount,0)) AS revenue,
         COUNT(oa.id) AS orders
       FROM order_archive oa
       JOIN branches b ON b.id = oa.branch_id
       WHERE b.restaurant_id = $1
         AND oa.created_at::date >= $2::date
         AND oa.created_at::date <= $3::date
       GROUP BY TO_CHAR(oa.created_at,'YYYY-MM-DD')
       ORDER BY date`,
      [restaurantId, from, to]
    );

    // Filial bo'yicha yig'ma
    const byBranchRes = await pool.query(
      `SELECT
         b.id, b.name,
         SUM(oa.total_amount + COALESCE(oa.service_fee_amount,0)) AS revenue,
         COUNT(oa.id) AS orders
       FROM branches b
       LEFT JOIN order_archive oa ON oa.branch_id = b.id
         AND oa.created_at::date >= $2::date AND oa.created_at::date <= $3::date
       WHERE b.restaurant_id = $1
       GROUP BY b.id ORDER BY revenue DESC NULLS LAST`,
      [restaurantId, from, to]
    );

    // Umumiy staff meal
    const smRes = await pool.query(
      `SELECT b.name AS branch_name, SUM(sm.quantity) AS total_portions
       FROM staff_meals sm JOIN branches b ON b.id = sm.branch_id
       WHERE b.restaurant_id = $1
         AND sm.created_at::date >= $2::date AND sm.created_at::date <= $3::date
       GROUP BY b.id, b.name ORDER BY total_portions DESC`,
      [restaurantId, from, to]
    );

    const totalRevenue = byBranchRes.rows.reduce((s, b) => s + parseFloat(b.revenue || 0), 0);
    const totalOrders  = byBranchRes.rows.reduce((s, b) => s + parseInt(b.orders || 0), 0);

    return success(res, {
      from, to,
      summary: { total_revenue: totalRevenue, total_orders: totalOrders },
      daily: dailyRes.rows,
      by_branch: byBranchRes.rows.map(b => ({ ...b, revenue: parseFloat(b.revenue || 0) })),
      staff_meals: smRes.rows,
    });
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = {
  getDashboard,
  compareBranches,
  getBranchRevenue,
  getBranchInventory,
  compareInventory,
  getBranchExpenses,
  getBranchStaff,
  getBranchStaffMeals,
  getBranchMenu,
  getBranchArchive,
  updateBranch,
  getGlobalReport,
};
