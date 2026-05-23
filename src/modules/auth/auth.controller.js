const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../../utils/jwt.utils');
const { success, error } = require('../../utils/response.utils');

const parsePermissions = (val) => {
  if (!val || val === '{}') return [];
  if (Array.isArray(val)) return val;
  return val.replace(/^{|}$/g, '').split(',').filter(Boolean);
};

// POST /auth/login
const login = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return error(res, 'Username va parol talab qilinadi');
  }
  // Parol minimal uzunlik tekshiruvi
  if (typeof password !== 'string' || password.length > 128) {
    return error(res, "Parol noto'g'ri formatda");
  }

  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE username = $1 AND is_active = TRUE`,
      [username]
    );
    // Foydalanuvchi topilmasa ham bir xil xabar — username enumeration oldini olish
    if (result.rows.length === 0) {
      await bcrypt.hash('dummy', 12); // timing attack oldini olish
      return error(res, "Username yoki parol noto'g'ri", 401);
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return error(res, "Username yoki parol noto'g'ri", 401);
    }

    const payload = {
      user_id: user.id,
      full_name: user.full_name,
      role: user.role,
      restaurant_id: user.restaurant_id,
      branch_id: user.branch_id,
      extra_permissions: parsePermissions(user.extra_permissions),
    };

    const accessToken  = generateAccessToken(payload);
    const refreshToken = generateRefreshToken({ user_id: user.id });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)`,
      [uuidv4(), user.id, refreshToken, expiresAt]
    );

    return success(res, {
      access_token: accessToken,
      refresh_token: refreshToken,
      role: user.role,
      extra_permissions: parsePermissions(user.extra_permissions),
      branch_id: user.branch_id,
      restaurant_id: user.restaurant_id,
      full_name: user.full_name,
    }, 'Muvaffaqiyatli kirildi');

  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

// POST /auth/refresh
const refresh = async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return error(res, 'Refresh token talab qilinadi');

  try {
    const payload = verifyRefreshToken(refresh_token);

    const tokenResult = await pool.query(
      `SELECT * FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()`,
      [refresh_token]
    );
    if (tokenResult.rows.length === 0) {
      return error(res, "Token noto'g'ri yoki muddati o'tgan", 401);
    }

    // Token rotatsiyasi — eski o'chir, yangi yoz
    await pool.query(`DELETE FROM refresh_tokens WHERE token = $1`, [refresh_token]);

    const userResult = await pool.query(
      `SELECT * FROM users WHERE id = $1 AND is_active = TRUE`,
      [payload.user_id]
    );
    if (userResult.rows.length === 0) {
      return error(res, 'Foydalanuvchi topilmadi', 401);
    }

    const user = userResult.rows[0];
    const newPayload = {
      user_id: user.id,
      full_name: user.full_name,
      role: user.role,
      restaurant_id: user.restaurant_id,
      branch_id: user.branch_id,
      extra_permissions: parsePermissions(user.extra_permissions),
    };

    const newAccessToken  = generateAccessToken(newPayload);
    const newRefreshToken = generateRefreshToken({ user_id: user.id });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)`,
      [uuidv4(), user.id, newRefreshToken, expiresAt]
    );

    return success(res, { access_token: newAccessToken, refresh_token: newRefreshToken }, 'Token yangilandi');
  } catch (err) {
    return error(res, "Token noto'g'ri yoki muddati o'tgan", 401);
  }
};

// POST /auth/logout
const logout = async (req, res) => {
  const { refresh_token } = req.body;
  if (refresh_token) {
    await pool.query(`DELETE FROM refresh_tokens WHERE token = $1`, [refresh_token]);
  }
  return success(res, {}, 'Chiqildi');
};

// POST /auth/logout-all  — barcha qurilmalardan chiqish
const logoutAll = async (req, res) => {
  try {
    await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [req.user.user_id]);
    return success(res, {}, "Barcha qurilmalardan chiqildi");
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

// PUT /auth/change-password
const changePassword = async (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password) {
    return error(res, 'Eski va yangi parol talab qilinadi');
  }
  // Kuchli parol tekshiruvi
  if (new_password.length < 8) {
    return error(res, 'Yangi parol kamida 8 ta belgidan iborat bo\'lishi kerak');
  }
  if (!/[A-Z]/.test(new_password) || !/[0-9]/.test(new_password)) {
    return error(res, "Parol kamida 1 ta katta harf va 1 ta raqam bo'lishi kerak");
  }
  if (new_password.length > 128) {
    return error(res, 'Parol juda uzun');
  }

  try {
    const result = await pool.query(`SELECT * FROM users WHERE id = $1`, [req.user.user_id]);
    const user = result.rows[0];

    const isMatch = await bcrypt.compare(old_password, user.password_hash);
    if (!isMatch) return error(res, "Eski parol noto'g'ri", 401);

    const newHash = await bcrypt.hash(new_password, 12);
    await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [newHash, req.user.user_id]
    );

    // Barcha refresh tokenlarni o'chirish (boshqa qurilmalardan chiqarish)
    await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [req.user.user_id]);

    return success(res, {}, "Parol muvaffaqiyatli o'zgartirildi");
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = { login, refresh, logout, logoutAll, changePassword };
