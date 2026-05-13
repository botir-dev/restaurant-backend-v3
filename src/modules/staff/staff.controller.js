const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { success, created, error } = require('../../utils/response.utils');

// GET /staff
const getStaff = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, username, phone, role, extra_permissions, is_active, created_at
       FROM users
       WHERE branch_id = $1 AND restaurant_id = $2 AND role != 'manager'
       ORDER BY created_at DESC`,
      [req.branchId, req.restaurantId]
    );
    return success(res, result.rows);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// POST /staff
const createStaff = async (req, res) => {
  const { full_name, username, phone, password, role, extra_permissions } = req.body;
  if (!full_name || !username || !password || !role) {
    return error(res, 'Ism, username, parol va rol talab qilinadi');
  }

  const validRoles = ['waiter', 'cashier', 'storekeeper', 'cook', 'baker',
    'somsa_maker', 'grill_master', 'turkish_cook', 'bartender', 'icecream_maker', 'tea_master'];
  if (!validRoles.includes(role)) {
    return error(res, 'Noto\'g\'ri rol');
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (id, restaurant_id, branch_id, full_name, username, phone, password_hash, role, extra_permissions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, full_name, username, role, extra_permissions`,
      [uuidv4(), req.restaurantId, req.branchId, full_name, username, phone,
       passwordHash, role, extra_permissions || []]
    );
    return created(res, result.rows[0], 'Hodim yaratildi');
  } catch (err) {
    if (err.code === '23505') return error(res, 'Bu username allaqachon mavjud');
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// PUT /staff/:id
const updateStaff = async (req, res) => {
  const { id } = req.params;
  const { full_name, phone, password, role, extra_permissions } = req.body;

  try {
    let passwordHash = undefined;
    if (password) passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `UPDATE users SET
        full_name = COALESCE($1, full_name),
        phone = COALESCE($2, phone),
        password_hash = COALESCE($3, password_hash),
        role = COALESCE($4, role),
        extra_permissions = COALESCE($5, extra_permissions),
        updated_at = NOW()
       WHERE id = $6 AND branch_id = $7 AND role != 'manager'
       RETURNING id, full_name, username, role, extra_permissions`,
      [full_name, phone, passwordHash, role, extra_permissions, id, req.branchId]
    );
    if (result.rows.length === 0) return error(res, 'Hodim topilmadi', 404);
    return success(res, result.rows[0], 'Hodim yangilandi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// DELETE /staff/:id  (soft delete)
const deleteStaff = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      `UPDATE users SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND branch_id = $2 AND role != 'manager'`,
      [id, req.branchId]
    );
    return success(res, {}, 'Hodim o\'chirildi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = { getStaff, createStaff, updateStaff, deleteStaff };
