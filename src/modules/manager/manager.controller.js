const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { success, created, error } = require('../../utils/response.utils');

// ============================================================
// MAXSUS ROLLAR
// ============================================================

// GET /manager/custom-roles
const getCustomRoles = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM custom_roles WHERE branch_id = $1 ORDER BY created_at ASC`,
      [req.branchId]
    );
    return success(res, result.rows);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// POST /manager/custom-roles
const createCustomRole = async (req, res) => {
  const { key, label, product_type_key } = req.body;
  if (!key || !label) return error(res, 'key va label talab qilinadi');

  // key faqat lotin harflari, raqamlar va _ dan iborat bo'lsin
  if (!/^[a-z0-9_]+$/.test(key)) {
    return error(res, 'key faqat kichik lotin harflari, raqamlar va _ dan iborat bo\'lishi kerak');
  }

  try {
    const result = await pool.query(
      `INSERT INTO custom_roles (id, restaurant_id, branch_id, key, label, product_type_key)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [uuidv4(), req.restaurantId, req.branchId, key, label, product_type_key || null]
    );
    return created(res, result.rows[0], 'Maxsus rol yaratildi');
  } catch (err) {
    if (err.code === '23505') return error(res, 'Bu key allaqachon mavjud');
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// DELETE /manager/custom-roles/:id
const deleteCustomRole = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      `DELETE FROM custom_roles WHERE id = $1 AND branch_id = $2`,
      [id, req.branchId]
    );
    return success(res, {}, "O'chirildi");
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ============================================================
// MAXSUS MAHSULOT TURLARI
// ============================================================

// GET /manager/custom-product-types
const getCustomProductTypes = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM custom_product_types WHERE branch_id = $1 ORDER BY created_at ASC`,
      [req.branchId]
    );
    return success(res, result.rows);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// POST /manager/custom-product-types
const createCustomProductType = async (req, res) => {
  const { key, label } = req.body;
  if (!key || !label) return error(res, 'key va label talab qilinadi');

  if (!/^[a-z0-9_]+$/.test(key)) {
    return error(res, 'key faqat kichik lotin harflari, raqamlar va _ dan iborat bo\'lishi kerak');
  }

  // Standart turlar bilan to'qnashuvni oldini olish
  const BASE_TYPES = ['food','bread','somsa','grill','turkish','drink','icecream','tea','other'];
  if (BASE_TYPES.includes(key)) {
    return error(res, 'Bu tur allaqachon standart turlar ro\'yxatida mavjud');
  }

  try {
    const result = await pool.query(
      `INSERT INTO custom_product_types (id, restaurant_id, branch_id, key, label)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [uuidv4(), req.restaurantId, req.branchId, key, label]
    );
    return created(res, result.rows[0], 'Mahsulot turi yaratildi');
  } catch (err) {
    if (err.code === '23505') return error(res, 'Bu key allaqachon mavjud');
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// DELETE /manager/custom-product-types/:id
const deleteCustomProductType = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      `DELETE FROM custom_product_types WHERE id = $1 AND branch_id = $2`,
      [id, req.branchId]
    );
    return success(res, {}, "O'chirildi");
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = {
  getCustomRoles, createCustomRole, deleteCustomRole,
  getCustomProductTypes, createCustomProductType, deleteCustomProductType,
};
