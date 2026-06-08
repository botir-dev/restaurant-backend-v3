const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { success, created, error, paginate } = require('../../utils/response.utils');
const { checkInventoryAlerts } = require('../../utils/inventory.alerts');

// ─────────────────────────────────────────────────────────────
// POST /staff-meals
// Xodimlar uchun taom kiritish. Ombordan retsept bo'yicha ayiriladi,
// daromad hisobida ko'rinmaydi, lekin inventory_logs da 'staff_meal' sifatida qayd etiladi.
// ─────────────────────────────────────────────────────────────
const createStaffMeal = async (req, res) => {
  const { menu_item_id, quantity, note } = req.body;

  if (!menu_item_id) return error(res, 'menu_item_id talab qilinadi');
  const qty = parseInt(quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 999)
    return error(res, "Miqdor 1-999 orasida bo'lishi kerak");

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Menu itemni tekshirish
    const menuRes = await client.query(
      `SELECT id, name FROM menu_items WHERE id = $1 AND branch_id = $2`,
      [menu_item_id, req.branchId]
    );
    if (menuRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return error(res, 'Taom topilmadi', 404);
    }
    const menuItem = menuRes.rows[0];

    // Retseptni olish
    const recipeRes = await client.query(
      `SELECT r.inventory_item_id, r.quantity as recipe_qty,
              inv.quantity as stock_qty, inv.unit, inv.custom_unit, inv.name as inv_name
       FROM menu_item_recipes r
       JOIN inventory_items inv ON inv.id = r.inventory_item_id
       WHERE r.menu_item_id = $1 AND inv.branch_id = $2`,
      [menu_item_id, req.branchId]
    );

    if (recipeRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return error(res, "Bu taom uchun retsept yo'q — ombordan ayirib bo'lmaydi. Avval retsept kiriting.", 400);
    }

    // Staff meal yozuvini qo'shish
    const mealId = uuidv4();
    const mealResult = await client.query(
      `INSERT INTO staff_meals
         (id, restaurant_id, branch_id, menu_item_id, menu_item_name, quantity, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        mealId,
        req.restaurantId || req.user.restaurant_id,
        req.branchId,
        menu_item_id,
        menuItem.name,
        qty,
        note?.trim() || null,
        req.user.user_id,
      ]
    );

    // Ombordan retsept bo'yicha ayirish
    const affectedIds = [];
    for (const rLine of recipeRes.rows) {
      const needed = parseFloat(rLine.recipe_qty) * qty;
      const currentStock = parseFloat(rLine.stock_qty);
      const afterStock = Math.max(0, currentStock - needed);

      await client.query(
        `UPDATE inventory_items
         SET quantity = GREATEST(0, quantity - $1), updated_at = NOW()
         WHERE id = $2 AND branch_id = $3`,
        [needed, rLine.inventory_item_id, req.branchId]
      );

      await client.query(
        `INSERT INTO inventory_logs
           (id, branch_id, inventory_item_id, change_amount, reason, order_id, before_quantity, after_quantity)
         VALUES ($1, $2, $3, $4, 'staff_meal', $5, $6, $7)`,
        [
          uuidv4(),
          req.branchId,
          rLine.inventory_item_id,
          -needed,
          mealId,  // order_id o'rniga staff_meal id saqlanadi
          currentStock,
          afterStock,
        ]
      );

      if (!affectedIds.includes(rLine.inventory_item_id)) {
        affectedIds.push(rLine.inventory_item_id);
      }
    }

    await client.query('COMMIT');

    // Min quantity alertlar (fon rejimida)
    if (affectedIds.length > 0) {
      checkInventoryAlerts(req.branchId, affectedIds).catch(() => {});
    }

    return created(res, mealResult.rows[0], "Staff meal qayd etildi, ombordan ayirildi");
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return error(res, 'Server xatosi', 500);
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────
// GET /staff-meals
// Staff meal ro'yxati, sanadan/sanagacha filtr bilan
// ─────────────────────────────────────────────────────────────
const getStaffMeals = async (req, res) => {
  const { from, to, menu_item_id } = req.query;
  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
  const offset = (page - 1) * limit;

  try {
    let where = `WHERE sm.branch_id = $1`;
    const params = [req.branchId];
    let idx = 2;

    if (from) {
      const d = new Date(from);
      if (isNaN(d.getTime())) return error(res, "from sanasi noto'g'ri formatda");
      where += ` AND sm.created_at >= $${idx++}`;
      params.push(d.toISOString());
    }
    if (to) {
      const d = new Date(to);
      if (isNaN(d.getTime())) return error(res, "to sanasi noto'g'ri formatda");
      where += ` AND sm.created_at <= $${idx++}`;
      params.push(d.toISOString());
    }
    if (menu_item_id) {
      where += ` AND sm.menu_item_id = $${idx++}`;
      params.push(menu_item_id);
    }

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM staff_meals sm ${where}`, params
    );
    const total = parseInt(countRes.rows[0].count);

    const result = await pool.query(
      `SELECT
         sm.id, sm.menu_item_id, sm.menu_item_name,
         sm.quantity, sm.note,
         sm.created_at,
         u.username as created_by_name
       FROM staff_meals sm
       LEFT JOIN users u ON u.id = sm.created_by
       ${where}
       ORDER BY sm.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return paginate(res, result.rows, total, page, limit);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /staff-meals/report
// Hisobot: qaysi taomdan nechta yeyilgan, sanadan/sanagacha
// ─────────────────────────────────────────────────────────────
const getStaffMealReport = async (req, res) => {
  const { from, to } = req.query;

  try {
    let where = `WHERE sm.branch_id = $1`;
    const params = [req.branchId];
    let idx = 2;

    if (from) {
      const d = new Date(from);
      if (isNaN(d.getTime())) return error(res, "from sanasi noto'g'ri formatda");
      where += ` AND sm.created_at >= $${idx++}`;
      params.push(d.toISOString());
    }
    if (to) {
      const d = new Date(to);
      if (isNaN(d.getTime())) return error(res, "to sanasi noto'g'ri formatda");
      where += ` AND sm.created_at <= $${idx++}`;
      params.push(d.toISOString());
    }

    // Taom bo'yicha yig'ma
    const byDish = await pool.query(
      `SELECT
         sm.menu_item_id,
         sm.menu_item_name,
         SUM(sm.quantity) AS total_quantity,
         COUNT(*)          AS record_count,
         MAX(sm.created_at) AS last_recorded_at
       FROM staff_meals sm
       ${where}
       GROUP BY sm.menu_item_id, sm.menu_item_name
       ORDER BY total_quantity DESC`,
      params
    );

    // Kunlik yig'ma
    const daily = await pool.query(
      `SELECT
         TO_CHAR(sm.created_at, 'YYYY-MM-DD') AS date,
         SUM(sm.quantity)                       AS total_quantity,
         COUNT(*)                               AS record_count
       FROM staff_meals sm
       ${where}
       GROUP BY TO_CHAR(sm.created_at, 'YYYY-MM-DD')
       ORDER BY date DESC`,
      params
    );

    // Umumiy xulosa
    const summary = await pool.query(
      `SELECT
         SUM(sm.quantity)  AS total_portions,
         COUNT(*)           AS total_records,
         COUNT(DISTINCT sm.menu_item_id) AS unique_dishes
       FROM staff_meals sm
       ${where}`,
      params
    );

    // Ombordan ketgan mahsulotlar (staff_meal sababli)
    const inventoryUsage = await pool.query(
      `SELECT
         i.name  AS inventory_item_name,
         i.unit,
         i.custom_unit,
         ABS(SUM(l.change_amount)) AS total_used
       FROM inventory_logs l
       JOIN inventory_items i ON i.id = l.inventory_item_id
       WHERE l.branch_id = $1
         AND l.reason = 'staff_meal'
         ${from ? `AND l.created_at >= $${params.indexOf(new Date(from).toISOString()) + 1}` : ''}
         ${to ? `AND l.created_at <= $${params.indexOf(new Date(to).toISOString()) + 1}` : ''}
       GROUP BY i.id, i.name, i.unit, i.custom_unit
       ORDER BY total_used DESC`,
      params
    );

    return success(res, {
      summary: summary.rows[0],
      by_dish: byDish.rows,
      daily: daily.rows,
      inventory_usage: inventoryUsage.rows,
    });
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ─────────────────────────────────────────────────────────────
// DELETE /staff-meals/:id
// Faqat bugun kiritilgan yozuvni o'chirish mumkin
// (omborga qaytarib qo'yiladi)
// ─────────────────────────────────────────────────────────────
const deleteStaffMeal = async (req, res) => {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const mealRes = await client.query(
      `SELECT * FROM staff_meals WHERE id = $1 AND branch_id = $2 FOR UPDATE`,
      [id, req.branchId]
    );
    if (mealRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return error(res, 'Yozuv topilmadi', 404);
    }
    const meal = mealRes.rows[0];

    // Faqat bugun kiritilganini o'chirish mumkin
    const today = new Date();
    const mealDate = new Date(meal.created_at);
    const sameDay =
      today.getFullYear() === mealDate.getFullYear() &&
      today.getMonth()    === mealDate.getMonth()    &&
      today.getDate()     === mealDate.getDate();

    if (!sameDay) {
      await client.query('ROLLBACK');
      return error(res, "Faqat bugun kiritilgan yozuvni o'chirish mumkin", 400);
    }

    // Omborga qaytarib qo'shish — retsept bo'yicha
    const recipeRes = await client.query(
      `SELECT r.inventory_item_id, r.quantity as recipe_qty, inv.quantity as stock_qty
       FROM menu_item_recipes r
       JOIN inventory_items inv ON inv.id = r.inventory_item_id
       WHERE r.menu_item_id = $1 AND inv.branch_id = $2`,
      [meal.menu_item_id, req.branchId]
    );

    for (const rLine of recipeRes.rows) {
      const returnAmt = parseFloat(rLine.recipe_qty) * meal.quantity;
      const currentStock = parseFloat(rLine.stock_qty);
      const afterStock = currentStock + returnAmt;

      await client.query(
        `UPDATE inventory_items SET quantity = quantity + $1, updated_at = NOW()
         WHERE id = $2 AND branch_id = $3`,
        [returnAmt, rLine.inventory_item_id, req.branchId]
      );

      await client.query(
        `INSERT INTO inventory_logs
           (id, branch_id, inventory_item_id, change_amount, reason, order_id, before_quantity, after_quantity)
         VALUES ($1, $2, $3, $4, 'staff_meal_cancel', $5, $6, $7)`,
        [uuidv4(), req.branchId, rLine.inventory_item_id, returnAmt, id, currentStock, afterStock]
      );
    }

    await client.query(`DELETE FROM staff_meals WHERE id = $1`, [id]);
    await client.query('COMMIT');

    return success(res, {}, "Staff meal o'chirildi, mahsulotlar omborga qaytarildi");
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return error(res, 'Server xatosi', 500);
  } finally {
    client.release();
  }
};

module.exports = { createStaffMeal, getStaffMeals, getStaffMealReport, deleteStaffMeal };
