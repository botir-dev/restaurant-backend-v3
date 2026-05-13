const pool = require('../../config/database');
const { success, error } = require('../../utils/response.utils');

// GET /dashboard
const getDashboard = async (req, res) => {
  const branchId = req.branchId;

  try {
    const [topProducts, busyTables, topWaiters, revenueChart, tableStatuses] = await Promise.all([

      // Top 10 mahsulot
      pool.query(`
        SELECT item->>'name' as name, item->>'type' as type,
               SUM((item->>'quantity')::int) as total_sold
        FROM order_archive a, jsonb_array_elements(items) as item
        WHERE a.branch_id = $1 AND a.created_at >= date_trunc('month', NOW())
        GROUP BY item->>'name', item->>'type'
        ORDER BY total_sold DESC LIMIT 10
      `, [branchId]),

      // Eng band stollar (oylik)
      pool.query(`
        SELECT table_number, COUNT(*) as order_count, SUM(total_amount) as revenue
        FROM order_archive
        WHERE branch_id = $1 AND created_at >= date_trunc('month', NOW())
        GROUP BY table_number
        ORDER BY order_count DESC LIMIT 10
      `, [branchId]),

      // Eng faol ofitsiantlar
      pool.query(`
        SELECT waiter_name, COUNT(*) as orders_served, SUM(total_amount) as total_revenue
        FROM order_archive
        WHERE branch_id = $1 AND created_at >= date_trunc('month', NOW())
        GROUP BY waiter_id, waiter_name
        ORDER BY total_revenue DESC LIMIT 10
      `, [branchId]),

      // Kunlik daromad (oxirgi 30 kun)
      pool.query(`
        SELECT DATE(created_at) as date, SUM(total_amount) as revenue, COUNT(*) as orders
        FROM order_archive
        WHERE branch_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `, [branchId]),

      // Stollar holati
      pool.query(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN is_occupied THEN 1 ELSE 0 END) as occupied,
          SUM(CASE WHEN NOT is_occupied THEN 1 ELSE 0 END) as free,
          (SELECT COUNT(*) FROM reservations WHERE branch_id = $1 AND status = 'active'
           AND reserved_at BETWEEN NOW() AND NOW() + INTERVAL '3 hours') as upcoming_reservations
        FROM tables WHERE branch_id = $1
      `, [branchId])
    ]);

    return success(res, {
      top_products: topProducts.rows,
      busy_tables: busyTables.rows,
      top_waiters: topWaiters.rows,
      revenue_chart: revenueChart.rows,
      table_overview: tableStatuses.rows[0]
    });
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = { getDashboard };
