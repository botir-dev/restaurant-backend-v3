const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { success, created, error, paginate } = require('../../utils/response.utils');

// GET /products?type=food&is_available=true&page=1&limit=20
const getProducts = async (req, res) => {
  const { type, is_available, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  try {
    let where = `WHERE p.branch_id = $1 AND p.restaurant_id = $2`;
    const params = [req.branchId, req.restaurantId];
    let idx = 3;

    if (type) { where += ` AND p.type = $${idx++}`; params.push(type); }
    if (is_available !== undefined) { where += ` AND p.is_available = $${idx++}`; params.push(is_available === 'true'); }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM products p ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT * FROM products p ${where} ORDER BY p.type, p.name LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );
    return paginate(res, result.rows, total, page, limit);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// POST /products
const createProduct = async (req, res) => {
  const { name, price, type, image_url } = req.body;
  if (!name || !type || !image_url) {
    return error(res, 'Nom, tur va rasm URL talab qilinadi');
  }

  try {
    const result = await pool.query(
      `INSERT INTO products (id, restaurant_id, branch_id, name, price, type, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [uuidv4(), req.restaurantId, req.branchId, name, price || 0, type, image_url]
    );
    return created(res, result.rows[0], 'Mahsulot qo\'shildi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// PUT /products/:id
const updateProduct = async (req, res) => {
  const { id } = req.params;
  const { name, price, type, image_url, is_available } = req.body;

  try {
    const result = await pool.query(
      `UPDATE products SET
        name = COALESCE($1, name), price = COALESCE($2, price),
        type = COALESCE($3, type), image_url = COALESCE($4, image_url),
        is_available = COALESCE($5, is_available), updated_at = NOW()
       WHERE id = $6 AND branch_id = $7 RETURNING *`,
      [name, price, type, image_url, is_available, id, req.branchId]
    );
    if (result.rows.length === 0) return error(res, 'Mahsulot topilmadi', 404);
    return success(res, result.rows[0], 'Mahsulot yangilandi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// DELETE /products/:id
const deleteProduct = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM products WHERE id = $1 AND branch_id = $2`, [id, req.branchId]);
    return success(res, {}, 'Mahsulot o\'chirildi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// PATCH /products/:id/availability
const toggleAvailability = async (req, res) => {
  const { id } = req.params;
  const { is_available } = req.body;
  if (is_available === undefined) return error(res, 'is_available talab qilinadi');

  try {
    // Tekshirish: kim o'zgartira oladi?
    // Manager, storekeeper — har qanday mahsulot
    // Tayyorlovchi — faqat o'z turi
    const productResult = await pool.query(
      `SELECT type FROM products WHERE id = $1 AND branch_id = $2`,
      [id, req.branchId]
    );
    if (productResult.rows.length === 0) return error(res, 'Mahsulot topilmadi', 404);

    const productType = productResult.rows[0].type;
    const { role, extra_permissions } = req.user;

    if (role !== 'manager' && role !== 'storekeeper') {
      const { getAllowedTypes } = require('../../utils/roles.utils');
      const allowed = getAllowedTypes(role, extra_permissions);
      if (!allowed.includes(productType)) {
        return error(res, 'Siz bu mahsulotni o\'zgartira olmaysiz', 403);
      }
    }

    const result = await pool.query(
      `UPDATE products SET is_available = $1, updated_at = NOW()
       WHERE id = $2 AND branch_id = $3 RETURNING id, name, is_available`,
      [is_available, id, req.branchId]
    );
    return success(res, result.rows[0], 'Mavjudlik holati yangilandi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = { getProducts, createProduct, updateProduct, deleteProduct, toggleAvailability };
