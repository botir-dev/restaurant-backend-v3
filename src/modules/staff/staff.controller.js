const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { success, created, error } = require('../../utils/response.utils');

const BASE_ROLES = ['waiter', 'cashier', 'storekeeper', 'cook', 'baker',
  'somsa_maker', 'grill_master', 'turkish_cook', 'bartender', 'icecream_maker', 'tea_master'];

const validatePassword = (password) => {
  if (password.length < 8) return "Parol kamida 8 ta belgidan iborat bo'lishi kerak";
  if (password.length > 128) return 'Parol juda uzun';
  if (!/[A-Z]/.test(password)) return "Parol kamida 1 ta katta harf bo'lishi kerak";
  if (!/[0-9]/.test(password)) return "Parol kamida 1 ta raqam bo'lishi kerak";
  return null;
};

// GET /staff
const getStaff = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, username, phone, role, extra_permissions, is_active, monthly_salary, use_commission, created_at
       FROM users
       WHERE branch_id = $1 AND restaurant_id = $2
         AND role != 'super_admin' AND is_active = TRUE
       ORDER BY
         CASE WHEN role = 'manager' THEN 0 ELSE 1 END,
         created_at DESC`,
      [req.branchId, req.restaurantId]
    );
    return success(res, result.rows);
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

// POST /staff
const createStaff = async (req, res) => {
  const { full_name, username, phone, password, role, extra_permissions } = req.body;
  if (!full_name || !username || !password || !role) {
    return error(res, 'Ism, username, parol va rol talab qilinadi');
  }

  const passErr = validatePassword(password);
  if (passErr) return error(res, passErr);

  try {
    // Standart rol emas bo'lsa — custom_roles jadvalidan tekshirish
    if (!BASE_ROLES.includes(role)) {
      const customCheck = await pool.query(
        `SELECT id FROM custom_roles WHERE key = $1 AND branch_id = $2`,
        [role, req.branchId]
      );
      if (customCheck.rows.length === 0) {
        return error(res, "Noto'g'ri rol. Avval bu rolni custom_roles ga qo'shing");
      }
    }

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
    if (err.code === '22P02') return error(res, "Bu rol ENUM da yo'q. Migration kerak");
    return error(res, 'Server xatosi', 500);
  }
};

// PUT /staff/:id
const updateStaff = async (req, res) => {
  const { id } = req.params;
  const { full_name, phone, password, role, extra_permissions, monthly_salary } = req.body;

  try {
    // Manager o'zini yangilayapti yoki boshqa xodimni?
    const targetUser = await pool.query(
      `SELECT id, role FROM users WHERE id = $1 AND branch_id = $2`,
      [id, req.branchId]
    );
    if (targetUser.rows.length === 0) return error(res, 'Hodim topilmadi', 404);

    const isManager = targetUser.rows[0].role === 'manager';

    // Manager o'zini yangilasa — faqat maosh va parol o'zgartirilsin
    if (isManager) {
      let passwordHash = undefined;
      if (password) {
        const passErr = validatePassword(password);
        if (passErr) return error(res, passErr);
        passwordHash = await bcrypt.hash(password, 12);
      }
      const result = await pool.query(
        `UPDATE users SET
          monthly_salary = COALESCE($1, monthly_salary),
          password_hash = COALESCE($2, password_hash),
          updated_at = NOW()
         WHERE id = $3 AND branch_id = $4
         RETURNING id, full_name, username, role, extra_permissions, monthly_salary, use_commission`,
        [monthly_salary !== undefined ? monthly_salary : null, passwordHash, id, req.branchId]
      );
      return success(res, result.rows[0], 'Yangilandi');
    }

    // Rol o'zgartirilsa tekshirish
    if (role && !BASE_ROLES.includes(role)) {
      const customCheck = await pool.query(
        `SELECT id FROM custom_roles WHERE key = $1 AND branch_id = $2`,
        [role, req.branchId]
      );
      if (customCheck.rows.length === 0) {
        return error(res, "Noto'g'ri rol");
      }
    }

    let passwordHash = undefined;
    if (password) {
      const passErr = validatePassword(password);
      if (passErr) return error(res, passErr);
      passwordHash = await bcrypt.hash(password, 12);
    }

    const { use_commission } = req.body;
    const salary = monthly_salary !== undefined ? monthly_salary : null;

    const result = await pool.query(
      `UPDATE users SET
        full_name = COALESCE($1, full_name),
        phone = COALESCE($2, phone),
        password_hash = COALESCE($3, password_hash),
        role = COALESCE($4, role),
        extra_permissions = COALESCE($5, extra_permissions),
        monthly_salary = COALESCE($6, monthly_salary),
        use_commission = COALESCE($7, use_commission),
        updated_at = NOW()
       WHERE id = $8 AND branch_id = $9
       RETURNING id, full_name, username, role, extra_permissions, monthly_salary, use_commission`,
      [full_name, phone, passwordHash, role, extra_permissions, salary,
       use_commission !== undefined ? use_commission : null, id, req.branchId]
    );
    if (result.rows.length === 0) return error(res, 'Hodim topilmadi', 404);
    return success(res, result.rows[0], 'Hodim yangilandi');
  } catch (err) {
    if (err.code === '22P02') return error(res, 'Bu rol tizimda mavjud emas');
    return error(res, 'Server xatosi', 500);
  }
};

// DELETE /staff/:id (soft delete)
const deleteStaff = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      `UPDATE users SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND branch_id = $2 AND role != 'manager'`,
      [id, req.branchId]
    );
    return success(res, {}, "Hodim o'chirildi");
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = { getStaff, createStaff, updateStaff, deleteStaff };
