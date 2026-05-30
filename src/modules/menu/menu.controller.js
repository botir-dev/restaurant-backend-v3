const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { success, created, error, paginate } = require('../../utils/response.utils');

// ─── GET /menu ─────────────────────────────────────────────────
const getMenuItems = async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const { type, is_available, search } = req.query;

  try {
    let where = `WHERE mi.branch_id = $1 AND mi.restaurant_id = $2`;
    const params = [req.branchId, req.restaurantId];
    let idx = 3;

    if (type) { where += ` AND mi.type = $${idx++}`; params.push(type); }
    if (is_available !== undefined) {
      where += ` AND mi.is_available = $${idx++}`;
      params.push(is_available === 'true');
    }
    if (search) {
      where += ` AND mi.name ILIKE $${idx++}`;
      params.push(`%${search.trim()}%`);
    }

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM menu_items mi ${where}`, params
    );
    const total = parseInt(countRes.rows[0].count);

    const canSeeRecipe = ['manager', 'storekeeper', 'super_admin'].includes(req.user.role);

    let result;
    if (canSeeRecipe) {
      result = await pool.query(
        `SELECT mi.*,
           COALESCE(
             json_agg(
               json_build_object(
                 'id', r.id,
                 'inventory_item_id', r.inventory_item_id,
                 'inventory_name', inv.name,
                 'inventory_unit', inv.unit,
                 'inventory_custom_unit', inv.custom_unit,
                 'quantity', r.quantity
               ) ORDER BY inv.name
             ) FILTER (WHERE r.id IS NOT NULL), '[]'
           ) AS recipe
         FROM menu_items mi
         LEFT JOIN menu_item_recipes r  ON r.menu_item_id = mi.id
         LEFT JOIN inventory_items inv  ON inv.id = r.inventory_item_id
         ${where}
         GROUP BY mi.id
         ORDER BY mi.type, mi.name
         LIMIT $${idx} OFFSET $${idx+1}`,
        [...params, limit, offset]
      );
    } else {
      result = await pool.query(
        `SELECT mi.id, mi.name, mi.price, mi.type, mi.image_url, mi.is_available
         FROM menu_items mi
         ${where}
         ORDER BY mi.type, mi.name
         LIMIT $${idx} OFFSET $${idx+1}`,
        [...params, limit, offset]
      );
    }
    return paginate(res, result.rows, total, page, limit);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ─── POST /menu ────────────────────────────────────────────────
// Body: { name, price, type, image_url, is_available, recipe: [{inventory_item_id, quantity}] }
const createMenuItem = async (req, res) => {
  const { name, price, type, image_url, is_available, recipe } = req.body;
  if (!name?.trim()) return error(res, 'Nom talab qilinadi');
  if (!type?.trim()) return error(res, 'Tur talab qilinadi');
  const parsedPrice = parseFloat(price);
  if (isNaN(parsedPrice) || parsedPrice < 0) return error(res, "Narx 0 dan katta bo'lishi kerak");

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const menuId = uuidv4();
    const itemRes = await client.query(
      `INSERT INTO menu_items (id, restaurant_id, branch_id, name, price, type, image_url, is_available)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [menuId, req.restaurantId, req.branchId,
       name.trim(), parsedPrice, type.trim(),
       image_url || null, is_available !== false]
    );

    // Retseptni saqlash
    if (Array.isArray(recipe) && recipe.length > 0) {
      for (const r of recipe) {
        if (!r.inventory_item_id || !r.quantity) continue;
        const qty = parseFloat(r.quantity);
        if (isNaN(qty) || qty <= 0) continue;

        // inventory item shu branchda mavjudmi?
        const invCheck = await client.query(
          `SELECT id FROM inventory_items WHERE id = $1 AND branch_id = $2`,
          [r.inventory_item_id, req.branchId]
        );
        if (invCheck.rows.length === 0) continue;

        await client.query(
          `INSERT INTO menu_item_recipes (id, menu_item_id, inventory_item_id, quantity)
           VALUES ($1,$2,$3,$4) ON CONFLICT (menu_item_id, inventory_item_id)
           DO UPDATE SET quantity = EXCLUDED.quantity`,
          [uuidv4(), menuId, r.inventory_item_id, qty]
        );
      }
    }

    await client.query('COMMIT');

    // To'liq ma'lumot bilan qaytarish
    const full = await pool.query(
      `SELECT mi.*,
         COALESCE(
           json_agg(
             json_build_object(
               'id', r.id,
               'inventory_item_id', r.inventory_item_id,
               'inventory_name', inv.name,
               'inventory_unit', inv.unit,
               'inventory_custom_unit', inv.custom_unit,
               'quantity', r.quantity
             ) ORDER BY inv.name
           ) FILTER (WHERE r.id IS NOT NULL), '[]'
         ) AS recipe
       FROM menu_items mi
       LEFT JOIN menu_item_recipes r ON r.menu_item_id = mi.id
       LEFT JOIN inventory_items inv ON inv.id = r.inventory_item_id
       WHERE mi.id = $1 GROUP BY mi.id`,
      [menuId]
    );
    return created(res, full.rows[0], "Menyu mahsuloti qo'shildi");
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return error(res, 'Server xatosi', 500);
  } finally {
    client.release();
  }
};

// ─── PUT /menu/:id ─────────────────────────────────────────────
const updateMenuItem = async (req, res) => {
  const { id } = req.params;
  const { name, price, type, image_url, is_available, recipe } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE menu_items SET
         name        = COALESCE($1, name),
         price       = COALESCE($2, price),
         type        = COALESCE($3, type),
         image_url   = COALESCE($4, image_url),
         is_available= COALESCE($5, is_available),
         updated_at  = NOW()
       WHERE id = $6 AND branch_id = $7 RETURNING *`,
      [
        name?.trim() || null,
        price !== undefined ? parseFloat(price) : null,
        type?.trim() || null,
        image_url !== undefined ? (image_url || null) : undefined,
        is_available !== undefined ? is_available : null,
        id, req.branchId
      ]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return error(res, 'Menyu mahsuloti topilmadi', 404);
    }

    // Retseptni yangilash — to'liq almashtirish
    if (Array.isArray(recipe)) {
      await client.query(`DELETE FROM menu_item_recipes WHERE menu_item_id = $1`, [id]);
      for (const r of recipe) {
        if (!r.inventory_item_id || !r.quantity) continue;
        const qty = parseFloat(r.quantity);
        if (isNaN(qty) || qty <= 0) continue;

        const invCheck = await client.query(
          `SELECT id FROM inventory_items WHERE id = $1 AND branch_id = $2`,
          [r.inventory_item_id, req.branchId]
        );
        if (invCheck.rows.length === 0) continue;

        await client.query(
          `INSERT INTO menu_item_recipes (id, menu_item_id, inventory_item_id, quantity)
           VALUES ($1,$2,$3,$4)`,
          [uuidv4(), id, r.inventory_item_id, qty]
        );
      }
    }

    await client.query('COMMIT');

    const full = await pool.query(
      `SELECT mi.*,
         COALESCE(
           json_agg(
             json_build_object(
               'id', r.id,
               'inventory_item_id', r.inventory_item_id,
               'inventory_name', inv.name,
               'inventory_unit', inv.unit,
               'inventory_custom_unit', inv.custom_unit,
               'quantity', r.quantity
             ) ORDER BY inv.name
           ) FILTER (WHERE r.id IS NOT NULL), '[]'
         ) AS recipe
       FROM menu_items mi
       LEFT JOIN menu_item_recipes r ON r.menu_item_id = mi.id
       LEFT JOIN inventory_items inv ON inv.id = r.inventory_item_id
       WHERE mi.id = $1 GROUP BY mi.id`,
      [id]
    );
    return success(res, full.rows[0], 'Yangilandi');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return error(res, 'Server xatosi', 500);
  } finally {
    client.release();
  }
};

// ─── DELETE /menu/:id ──────────────────────────────────────────
const deleteMenuItem = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `DELETE FROM menu_items WHERE id = $1 AND branch_id = $2 RETURNING id`,
      [id, req.branchId]
    );
    if (result.rows.length === 0) return error(res, 'Topilmadi', 404);
    return success(res, {}, "O'chirildi");
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ─── PATCH /menu/:id/availability ─────────────────────────────
const toggleMenuAvailability = async (req, res) => {
  const { id } = req.params;
  const { is_available } = req.body;
  if (is_available === undefined) return error(res, 'is_available talab qilinadi');
  try {
    const result = await pool.query(
      `UPDATE menu_items SET is_available = $1, updated_at = NOW()
       WHERE id = $2 AND branch_id = $3 RETURNING id, name, is_available`,
      [is_available, id, req.branchId]
    );
    if (result.rows.length === 0) return error(res, 'Topilmadi', 404);
    return success(res, result.rows[0], 'Holat yangilandi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = { getMenuItems, createMenuItem, updateMenuItem, deleteMenuItem, toggleMenuAvailability };
