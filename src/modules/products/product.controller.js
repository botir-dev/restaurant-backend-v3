const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { success, created, error, paginate } = require('../../utils/response.utils');

// Ruxsat etilgan mahsulot turlari (ENUM whitelist)
const VALID_PRODUCT_TYPES = [
  'food', 'drink', 'dessert', 'bread', 'somsa',
  'grill', 'turkish', 'bar', 'icecream', 'tea', 'other'
];

// Image URL SSRF himoyasi — faqat https:// ruxsat
const validateImageUrl = (url) => {
  if (!url) return true; // ixtiyoriy maydon
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    // Ichki IP va localhost bloklanadi
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.startsWith('127.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('172.') ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.local')
    ) return false;
    return true;
  } catch {
    return false;
  }
};

// GET /products?type=food&is_available=true&page=1&limit=20
const getProducts = async (req, res) => {
  const { type, is_available } = req.query;

  // Pagination DoS himoyasi — limit chegaralanadi
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  try {
    let where = `WHERE p.branch_id = $1 AND p.restaurant_id = $2`;
    const params = [req.branchId, req.restaurantId];
    let idx = 3;

    // type ENUM whitelist tekshiruvi
    if (type) {
      if (!VALID_PRODUCT_TYPES.includes(type)) return error(res, "Noto'g'ri mahsulot turi");
      where += ` AND p.type = $${idx++}`;
      params.push(type);
    }
    if (is_available !== undefined) {
      where += ` AND p.is_available = $${idx++}`;
      params.push(is_available === 'true');
    }

    const countResult = await pool.query(`SELECT COUNT(*) FROM products p ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT * FROM products p ${where} ORDER BY p.type, p.name LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );
    return paginate(res, result.rows, total, page, limit);
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

// POST /products
const createProduct = async (req, res) => {
  const { name, price, type, image_url } = req.body;
  if (!name || !type) return error(res, 'Nom va tur talab qilinadi');

  // ENUM tekshiruvi
  if (!VALID_PRODUCT_TYPES.includes(type)) return error(res, "Noto'g'ri mahsulot turi");

  // Narx validatsiyasi
  const parsedPrice = parseFloat(price);
  if (isNaN(parsedPrice) || parsedPrice < 0 || parsedPrice > 99_999_999) {
    return error(res, "Narx 0 dan katta va 99,999,999 dan kichik bo'lishi kerak");
  }

  // SSRF himoyasi
  if (image_url && !validateImageUrl(image_url)) {
    return error(res, "Rasm URL noto'g'ri yoki ruxsat etilmagan. Faqat https:// manzillar qabul qilinadi");
  }

  try {
    const result = await pool.query(
      `INSERT INTO products (id, restaurant_id, branch_id, name, price, type, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [uuidv4(), req.restaurantId, req.branchId, name.trim(), parsedPrice, type, image_url || null]
    );
    return created(res, result.rows[0], "Mahsulot qo'shildi");
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

// PUT /products/:id
const updateProduct = async (req, res) => {
  const { id } = req.params;
  const { name, price, type, image_url, is_available } = req.body;

  if (type !== undefined && !VALID_PRODUCT_TYPES.includes(type)) {
    return error(res, "Noto'g'ri mahsulot turi");
  }
  if (price !== undefined) {
    const p = parseFloat(price);
    if (isNaN(p) || p < 0 || p > 99_999_999) return error(res, "Narx 0 dan katta bo'lishi kerak");
  }
  if (image_url && !validateImageUrl(image_url)) {
    return error(res, "Rasm URL noto'g'ri yoki ruxsat etilmagan");
  }

  try {
    const result = await pool.query(
      `UPDATE products SET
        name         = COALESCE($1, name),
        price        = COALESCE($2, price),
        type         = COALESCE($3, type),
        image_url    = COALESCE($4, image_url),
        is_available = COALESCE($5, is_available),
        updated_at   = NOW()
       WHERE id = $6 AND branch_id = $7 RETURNING *`,
      [name?.trim() || null, price !== undefined ? parseFloat(price) : null,
       type || null, image_url || null,
       is_available !== undefined ? is_available : null, id, req.branchId]
    );
    if (result.rows.length === 0) return error(res, 'Mahsulot topilmadi', 404);
    return success(res, result.rows[0], 'Mahsulot yangilandi');
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

// DELETE /products/:id  — faol buyurtmalarda bo'lsa bloklanadi
const deleteProduct = async (req, res) => {
  const { id } = req.params;
  try {
    // Faol buyurtmalarda bu mahsulot bormi?
    const activeCheck = await pool.query(
      `SELECT o.id FROM orders o
       WHERE o.branch_id = $1
         AND o.status NOT IN ('paid', 'cancelled')
         AND o.items @> $2::jsonb`,
      [req.branchId, JSON.stringify([{ product_id: id }])]
    );
    if (activeCheck.rows.length > 0) {
      return error(res, "Bu mahsulot faol buyurtmalarda mavjud. Avval buyurtmalar yakunlansin.", 400);
    }

    const result = await pool.query(
      `DELETE FROM products WHERE id = $1 AND branch_id = $2 RETURNING id`,
      [id, req.branchId]
    );
    if (result.rows.length === 0) return error(res, 'Mahsulot topilmadi', 404);
    return success(res, {}, "Mahsulot o'chirildi");
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

// PATCH /products/:id/availability
const toggleAvailability = async (req, res) => {
  const { id } = req.params;
  const { is_available } = req.body;
  if (is_available === undefined) return error(res, 'is_available talab qilinadi');

  try {
    const productResult = await pool.query(
      `SELECT type FROM products WHERE id = $1 AND branch_id = $2`,
      [id, req.branchId]
    );
    if (productResult.rows.length === 0) return error(res, 'Mahsulot topilmadi', 404);

    const { role, extra_permissions } = req.user;
    if (role !== 'manager' && role !== 'storekeeper') {
      const { getAllowedTypes } = require('../../utils/roles.utils');
      const allowed = await getAllowedTypes(role, extra_permissions, req.branchId);
      if (!allowed.includes(productResult.rows[0].type)) {
        return error(res, "Siz bu mahsulotni o'zgartira olmaysiz", 403);
      }
    }

    const result = await pool.query(
      `UPDATE products SET is_available = $1, updated_at = NOW()
       WHERE id = $2 AND branch_id = $3 RETURNING id, name, is_available`,
      [is_available, id, req.branchId]
    );
    return success(res, result.rows[0], 'Mavjudlik holati yangilandi');
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = { getProducts, createProduct, updateProduct, deleteProduct, toggleAvailability };
