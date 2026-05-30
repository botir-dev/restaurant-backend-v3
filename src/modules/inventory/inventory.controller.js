const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { success, created, error, paginate } = require('../../utils/response.utils');

const VALID_UNITS = ['kg', 'L', 'dona', 'g', 'ml', 'custom'];

// GET /inventory
const getInventory = async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const { search } = req.query;

  try {
    let where = `WHERE branch_id = $1 AND restaurant_id = $2`;
    const params = [req.branchId, req.restaurantId];
    let idx = 3;

    if (search) {
      where += ` AND name ILIKE $${idx++}`;
      params.push(`%${search.trim()}%`);
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM inventory_items ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const canSeeCost = ['manager', 'storekeeper', 'super_admin'].includes(req.user.role);

    const result = await pool.query(
      `SELECT id, restaurant_id, branch_id, name, unit, custom_unit,
              quantity, min_quantity, image_url, created_at, updated_at
              ${canSeeCost ? ", cost_price, purchased_at, ROUND(quantity * COALESCE(cost_price, 0), 2) AS total_cost" : ""}
       FROM inventory_items ${where}
       ORDER BY name ASC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );
    return paginate(res, result.rows, total, page, limit);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// POST /inventory
const createInventoryItem = async (req, res) => {
  const { name, unit, custom_unit, quantity, min_quantity, image_url, cost_price, purchased_at } = req.body;
  if (!name || !name.trim()) return error(res, 'Nom talab qilinadi');
  if (!VALID_UNITS.includes(unit)) return error(res, "Noto'g'ri birlik turi");
  if (unit === 'custom' && (!custom_unit || !custom_unit.trim()))
    return error(res, "custom_unit talab qilinadi");

  const qty = parseFloat(quantity) || 0;
  const minQty = parseFloat(min_quantity) || 0;
  if (qty < 0) return error(res, "Miqdor manfiy bo'lmasligi kerak");

  const costPrice = cost_price !== undefined ? parseFloat(cost_price) : null;
  if (costPrice !== null && (isNaN(costPrice) || costPrice < 0))
    return error(res, "Tannarx 0 dan katta bo'lishi kerak");

  const purchasedAt = purchased_at ? new Date(purchased_at) : new Date();
  if (isNaN(purchasedAt.getTime())) return error(res, "purchased_at sana formati noto'g'ri");

  try {
    const result = await pool.query(
      `INSERT INTO inventory_items
         (id, restaurant_id, branch_id, name, unit, custom_unit, quantity, min_quantity, image_url, cost_price, purchased_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [uuidv4(), req.restaurantId, req.branchId,
       name.trim(), unit, custom_unit?.trim() || null, qty, minQty, image_url || null,
       costPrice, purchasedAt]
    );
    return created(res, result.rows[0], "Omborxona mahsuloti qo'shildi");
  } catch (err) {
    if (err.code === '23505') return error(res, 'Bu nomli mahsulot allaqachon mavjud', 409);
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// PUT /inventory/:id
const updateInventoryItem = async (req, res) => {
  const { id } = req.params;
  const { name, unit, custom_unit, quantity, min_quantity, image_url, cost_price, purchased_at } = req.body;

  if (unit !== undefined && !VALID_UNITS.includes(unit))
    return error(res, "Noto'g'ri birlik turi");

  const costPrice = cost_price !== undefined ? parseFloat(cost_price) : undefined;
  if (costPrice !== undefined && (isNaN(costPrice) || costPrice < 0))
    return error(res, "Tannarx 0 dan katta bo'lishi kerak");

  const purchasedAt = purchased_at ? new Date(purchased_at) : undefined;
  if (purchasedAt !== undefined && isNaN(purchasedAt.getTime()))
    return error(res, "purchased_at sana formati noto'g'ri");

  try {
    const result = await pool.query(
      `UPDATE inventory_items SET
         name         = COALESCE($1, name),
         unit         = COALESCE($2, unit),
         custom_unit  = COALESCE($3, custom_unit),
         quantity     = COALESCE($4, quantity),
         min_quantity = COALESCE($5, min_quantity),
         image_url    = COALESCE($6, image_url),
         cost_price   = COALESCE($7, cost_price),
         purchased_at = COALESCE($8, purchased_at),
         updated_at   = NOW()
       WHERE id = $9 AND branch_id = $10 RETURNING *`,
      [
        name?.trim() || null,
        unit || null,
        custom_unit?.trim() || null,
        quantity !== undefined ? parseFloat(quantity) : null,
        min_quantity !== undefined ? parseFloat(min_quantity) : null,
        image_url !== undefined ? (image_url || null) : undefined,
        costPrice !== undefined ? costPrice : null,
        purchasedAt !== undefined ? purchasedAt : null,
        id, req.branchId
      ]
    );
    if (result.rows.length === 0) return error(res, 'Mahsulot topilmadi', 404);
    return success(res, result.rows[0], 'Yangilandi');
  } catch (err) {
    if (err.code === '23505') return error(res, 'Bu nomli mahsulot allaqachon mavjud', 409);
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// PATCH /inventory/:id/add  — omborga qo'shimcha qo'shish
const addStock = async (req, res) => {
  const { id } = req.params;
  const { amount, cost_price, purchased_at } = req.body;
  const addAmt = parseFloat(amount);
  if (isNaN(addAmt) || addAmt <= 0)
    return error(res, "Miqdor 0 dan katta bo'lishi kerak");

  const newCostPrice = cost_price !== undefined ? parseFloat(cost_price) : null;
  if (newCostPrice !== null && (isNaN(newCostPrice) || newCostPrice < 0))
    return error(res, "Tannarx 0 dan katta bo'lishi kerak");

  const purchasedAt = purchased_at ? new Date(purchased_at) : new Date();
  if (isNaN(purchasedAt.getTime())) return error(res, "purchased_at sana formati noto'g'ri");

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const itemRes = await client.query(
      `SELECT * FROM inventory_items WHERE id = $1 AND branch_id = $2 FOR UPDATE`,
      [id, req.branchId]
    );
    if (itemRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return error(res, 'Mahsulot topilmadi', 404);
    }
    const before = parseFloat(itemRes.rows[0].quantity);
    const after  = before + addAmt;

    await client.query(
      `UPDATE inventory_items SET
         quantity     = $1,
         cost_price   = COALESCE($2, cost_price),
         purchased_at = $3,
         updated_at   = NOW()
       WHERE id = $4`,
      [after, newCostPrice, purchasedAt, id]
    );
    await client.query(
      `INSERT INTO inventory_logs
         (id, branch_id, inventory_item_id, change_amount, reason, before_quantity, after_quantity)
       VALUES ($1,$2,$3,$4,'manual_add',$5,$6)`,
      [uuidv4(), req.branchId, id, addAmt, before, after]
    );
    await client.query('COMMIT');

    const updated = await pool.query(
      `SELECT * FROM inventory_items WHERE id = $1`, [id]
    );
    return success(res, updated.rows[0], 'Miqdor qo\'shildi');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return error(res, 'Server xatosi', 500);
  } finally {
    client.release();
  }
};

// DELETE /inventory/:id
const deleteInventoryItem = async (req, res) => {
  const { id } = req.params;
  try {
    // Retseptda ishlatilayotganmi?
    const used = await pool.query(
      `SELECT mi.name FROM menu_item_recipes r
       JOIN menu_items mi ON mi.id = r.menu_item_id
       WHERE r.inventory_item_id = $1 LIMIT 1`, [id]
    );
    if (used.rows.length > 0)
      return error(res, `Bu ingredient "${used.rows[0].name}" menyusining retseptida ishlatilmoqda. Avval retseptdan olib tashlang.`, 400);

    const result = await pool.query(
      `DELETE FROM inventory_items WHERE id = $1 AND branch_id = $2 RETURNING id`,
      [id, req.branchId]
    );
    if (result.rows.length === 0) return error(res, 'Mahsulot topilmadi', 404);
    return success(res, {}, "O'chirildi");
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// GET /inventory/logs
const getInventoryLogs = async (req, res) => {
  const { item_id } = req.query;
  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
  const offset = (page - 1) * limit;

  try {
    let where = `WHERE l.branch_id = $1`;
    const params = [req.branchId];
    let idx = 2;
    if (item_id) { where += ` AND l.inventory_item_id = $${idx++}`; params.push(item_id); }

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM inventory_logs l ${where}`, params
    );
    const total = parseInt(countRes.rows[0].count);

    const result = await pool.query(
      `SELECT l.*, i.name as item_name, i.unit, i.custom_unit
       FROM inventory_logs l
       JOIN inventory_items i ON i.id = l.inventory_item_id
       ${where}
       ORDER BY l.created_at DESC LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, limit, offset]
    );
    return paginate(res, result.rows, total, page, limit);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = { getInventory, createInventoryItem, updateInventoryItem, addStock, deleteInventoryItem, getInventoryLogs };
