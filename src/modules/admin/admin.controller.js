const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { success, created, error } = require('../../utils/response.utils');

// ============================================================
// RESTORANLAR
// ============================================================

// GET /admin/restaurants
const getRestaurants = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, address, logo_url, is_active, created_at FROM restaurants ORDER BY created_at DESC`
    );
    return success(res, result.rows);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// POST /admin/restaurants
const createRestaurant = async (req, res) => {
  const { name, address, logo_url } = req.body;
  if (!name) return error(res, 'Restoran nomi talab qilinadi');

  try {
    const result = await pool.query(
      `INSERT INTO restaurants (id, name, address, logo_url) VALUES ($1, $2, $3, $4) RETURNING *`,
      [uuidv4(), name, address, logo_url]
    );
    return created(res, result.rows[0], 'Restoran yaratildi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// PUT /admin/restaurants/:id
const updateRestaurant = async (req, res) => {
  const { id } = req.params;
  const { name, address, logo_url, is_active } = req.body;

  try {
    const result = await pool.query(
      `UPDATE restaurants SET name = COALESCE($1, name), address = COALESCE($2, address),
       logo_url = COALESCE($3, logo_url), is_active = COALESCE($4, is_active),
       updated_at = NOW() WHERE id = $5 RETURNING *`,
      [name, address, logo_url, is_active, id]
    );
    if (result.rows.length === 0) return error(res, 'Restoran topilmadi', 404);
    return success(res, result.rows[0], 'Restoran yangilandi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// DELETE /admin/restaurants/:id
const deleteRestaurant = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM restaurants WHERE id = $1`, [id]);
    return success(res, {}, 'Restoran o\'chirildi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ============================================================
// FILIALLAR
// ============================================================

// GET /admin/branches?restaurant_id=...
const getBranches = async (req, res) => {
  const { restaurant_id } = req.query;
  try {
    let query = `SELECT b.*, r.name as restaurant_name FROM branches b
                 JOIN restaurants r ON r.id = b.restaurant_id`;
    const params = [];
    if (restaurant_id) {
      query += ` WHERE b.restaurant_id = $1`;
      params.push(restaurant_id);
    }
    query += ` ORDER BY b.created_at DESC`;
    const result = await pool.query(query, params);
    return success(res, result.rows);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// POST /admin/branches
const createBranch = async (req, res) => {
  const { restaurant_id, name, address, phone } = req.body;
  if (!restaurant_id || !name) return error(res, 'restaurant_id va nom talab qilinadi');

  try {
    const result = await pool.query(
      `INSERT INTO branches (id, restaurant_id, name, address, phone) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [uuidv4(), restaurant_id, name, address, phone]
    );
    return created(res, result.rows[0], 'Filial yaratildi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// PUT /admin/branches/:id
const updateBranch = async (req, res) => {
  const { id } = req.params;
  const { name, address, phone, is_active } = req.body;

  try {
    const result = await pool.query(
      `UPDATE branches SET name = COALESCE($1, name), address = COALESCE($2, address),
       phone = COALESCE($3, phone), is_active = COALESCE($4, is_active),
       updated_at = NOW() WHERE id = $5 RETURNING *`,
      [name, address, phone, is_active, id]
    );
    if (result.rows.length === 0) return error(res, 'Filial topilmadi', 404);
    return success(res, result.rows[0], 'Filial yangilandi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ============================================================
// MENEJERLAR
// ============================================================

// GET /admin/managers
const getManagers = async (req, res) => {
  const { restaurant_id } = req.query;
  try {
    let query = `SELECT u.id, u.full_name, u.username, u.phone, u.is_active,
                 u.restaurant_id, u.branch_id, r.name as restaurant_name, b.name as branch_name
                 FROM users u
                 LEFT JOIN restaurants r ON r.id = u.restaurant_id
                 LEFT JOIN branches b ON b.id = u.branch_id
                 WHERE u.role = 'manager'`;
    const params = [];
    if (restaurant_id) {
      query += ` AND u.restaurant_id = $1`;
      params.push(restaurant_id);
    }
    query += ` ORDER BY u.created_at DESC`;
    const result = await pool.query(query, params);
    return success(res, result.rows);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// POST /admin/managers
const createManager = async (req, res) => {
  const { restaurant_id, branch_id, full_name, username, phone, password } = req.body;
  if (!restaurant_id || !branch_id || !full_name || !username || !password) {
    return error(res, 'Barcha majburiy maydonlar to\'ldirilishi kerak');
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (id, restaurant_id, branch_id, full_name, username, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'manager') RETURNING id, full_name, username, role`,
      [uuidv4(), restaurant_id, branch_id, full_name, username, phone, passwordHash]
    );
    return created(res, result.rows[0], 'Menejer yaratildi');
  } catch (err) {
    if (err.code === '23505') return error(res, 'Bu username allaqachon mavjud');
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// PUT /admin/managers/:id
const updateManager = async (req, res) => {
  const { id } = req.params;
  const { full_name, phone, password, is_active } = req.body;

  try {
    let passwordHash = undefined;
    if (password) passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `UPDATE users SET 
        full_name = COALESCE($1, full_name),
        phone = COALESCE($2, phone),
        password_hash = COALESCE($3, password_hash),
        is_active = COALESCE($4, is_active),
        updated_at = NOW()
       WHERE id = $5 AND role = 'manager' RETURNING id, full_name, username, role`,
      [full_name, phone, passwordHash, is_active, id]
    );
    if (result.rows.length === 0) return error(res, 'Menejer topilmadi', 404);
    return success(res, result.rows[0], 'Menejer yangilandi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// DELETE /admin/managers/:id
const deleteManager = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM users WHERE id = $1 AND role = 'manager'`, [id]);
    return success(res, {}, 'Menejer o\'chirildi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = {
  getRestaurants, createRestaurant, updateRestaurant, deleteRestaurant,
  getBranches, createBranch, updateBranch,
  getManagers, createManager, updateManager, deleteManager
};
