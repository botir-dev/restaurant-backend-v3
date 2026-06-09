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
  const { restaurant_id, branch_id, full_name, username, phone, password, telegram_chat_id } = req.body;
  if (!restaurant_id || !branch_id || !full_name || !username || !password) {
    return error(res, 'Barcha majburiy maydonlar to\'ldirilishi kerak');
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (id, restaurant_id, branch_id, full_name, username, phone, password_hash, role, telegram_chat_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'manager', $8) RETURNING id, full_name, username, role, telegram_chat_id`,
      [uuidv4(), restaurant_id, branch_id, full_name, username, phone || null, passwordHash, telegram_chat_id || null]
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
  const { full_name, phone, password, is_active, telegram_chat_id } = req.body;

  try {
    let passwordHash = undefined;
    if (password) passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `UPDATE users SET 
        full_name = COALESCE($1, full_name),
        phone = COALESCE($2, phone),
        password_hash = COALESCE($3, password_hash),
        is_active = COALESCE($4, is_active),
        telegram_chat_id = CASE WHEN $5::TEXT IS NOT NULL THEN $5::TEXT ELSE telegram_chat_id END,
        updated_at = NOW()
       WHERE id = $6 AND role = 'manager' RETURNING id, full_name, username, role, telegram_chat_id`,
      [full_name || null, phone || null, passwordHash || null, is_active ?? null, telegram_chat_id ?? null, id]
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

// ─────────────────────────────────────────────────────────────
// OWNER CRUD (faqat super_admin)
// ─────────────────────────────────────────────────────────────

// GET /admin/owners?restaurant_id=
const getOwners = async (req, res) => {
  const { restaurant_id } = req.query;
  try {
    let query = `SELECT u.id, u.full_name, u.username, u.phone, u.is_active,
                        u.restaurant_id, r.name as restaurant_name, u.created_at
                 FROM users u
                 LEFT JOIN restaurants r ON r.id = u.restaurant_id
                 WHERE u.role = 'owner'`;
    const params = [];
    if (restaurant_id) { query += ` AND u.restaurant_id = $1`; params.push(restaurant_id); }
    query += ` ORDER BY u.created_at DESC`;
    const result = await pool.query(query, params);
    return success(res, result.rows);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// POST /admin/owners
const createOwner = async (req, res) => {
  const { restaurant_id, full_name, username, phone, password, telegram_chat_id } = req.body;
  if (!restaurant_id || !full_name || !username || !password)
    return error(res, 'restaurant_id, full_name, username va password talab qilinadi');

  try {
    const existing = await pool.query(
      `SELECT id FROM users WHERE restaurant_id = $1 AND role = 'owner'`,
      [restaurant_id]
    );
    if (existing.rows.length > 0)
      return error(res, 'Bu restoranda allaqachon owner mavjud');

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (id, restaurant_id, branch_id, full_name, username, phone, password_hash, role, telegram_chat_id)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, 'owner', $7)
       RETURNING id, full_name, username, role, restaurant_id, telegram_chat_id`,
      [uuidv4(), restaurant_id, full_name, username, phone || null, passwordHash, telegram_chat_id || null]
    );
    return created(res, result.rows[0], 'Owner yaratildi');
  } catch (err) {
    if (err.code === '23505') return error(res, 'Bu username allaqachon mavjud');
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// PUT /admin/owners/:id
const updateOwner = async (req, res) => {
  const { id } = req.params;
  const { full_name, phone, is_active, telegram_chat_id } = req.body;
  try {
    const result = await pool.query(
      `UPDATE users SET
         full_name = COALESCE($1, full_name),
         phone     = COALESCE($2, phone),
         is_active = COALESCE($3, is_active),
         telegram_chat_id = CASE WHEN $4::TEXT IS NOT NULL THEN $4::TEXT ELSE telegram_chat_id END,
         updated_at = NOW()
       WHERE id = $5 AND role = 'owner'
       RETURNING id, full_name, username, phone, is_active, role, telegram_chat_id`,
      [full_name || null, phone || null, is_active ?? null, telegram_chat_id ?? null, id]
    );
    if (result.rows.length === 0) return error(res, 'Owner topilmadi', 404);
    return success(res, result.rows[0], 'Owner yangilandi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// DELETE /admin/owners/:id
const deleteOwner = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM users WHERE id = $1 AND role = 'owner'`, [id]);
    return success(res, {}, 'Owner o\'chirildi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = {
  getRestaurants, createRestaurant, updateRestaurant, deleteRestaurant,
  getBranches, createBranch, updateBranch,
  getManagers, createManager, updateManager, deleteManager,
  getOwners, createOwner, updateOwner, deleteOwner,
};
