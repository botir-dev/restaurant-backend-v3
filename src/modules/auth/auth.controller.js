const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../../utils/jwt.utils');
const { success, created, error } = require('../../utils/response.utils');

// POST /auth/login
const login = async (req, res) => {
  const { username, password, branch_id } = req.body;
  if (!username || !password) {
    return error(res, 'Username va parol talab qilinadi');
  }

  try {
    // branch_id berilgan bo'lsa filtr qo'shamiz (super_admin uchun kerak emas)
    let query = `SELECT * FROM users WHERE username = $1 AND is_active = TRUE`;
    const params = [username];

    if (branch_id) {
      query += ` AND branch_id = $2`;
      params.push(branch_id);
    }

    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      return error(res, 'Username yoki parol noto\'g\'ri', 401);
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return error(res, 'Username yoki parol noto\'g\'ri', 401);
    }

    const payload = {
      user_id: user.id,
      full_name: user.full_name,
      role: user.role,
      restaurant_id: user.restaurant_id,
      branch_id: user.branch_id,
      extra_permissions: user.extra_permissions || []
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken({ user_id: user.id });

    // Refresh tokenni saqlash
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)`,
      [uuidv4(), user.id, refreshToken, expiresAt]
    );

    return success(res, {
      access_token: accessToken,
      refresh_token: refreshToken,
      role: user.role,
      extra_permissions: user.extra_permissions || [],
      branch_id: user.branch_id,
      restaurant_id: user.restaurant_id,
      full_name: user.full_name
    }, 'Muvaffaqiyatli kirildi');

  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// POST /auth/refresh
const refresh = async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return error(res, 'Refresh token talab qilinadi');

  try {
    const payload = verifyRefreshToken(refresh_token);

    // Tokenni DBda tekshirish
    const tokenResult = await pool.query(
      `SELECT * FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()`,
      [refresh_token]
    );
    if (tokenResult.rows.length === 0) {
      return error(res, 'Token noto\'g\'ri yoki muddati o\'tgan', 401);
    }

    // Eski tokenni o'chirish (rotatsiya)
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
      extra_permissions: user.extra_permissions || []
    };

    const newAccessToken = generateAccessToken(newPayload);
    const newRefreshToken = generateRefreshToken({ user_id: user.id });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)`,
      [uuidv4(), user.id, newRefreshToken, expiresAt]
    );

    return success(res, {
      access_token: newAccessToken,
      refresh_token: newRefreshToken
    }, 'Token yangilandi');

  } catch (err) {
    return error(res, 'Token noto\'g\'ri yoki muddati o\'tgan', 401);
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

// PUT /auth/change-password
const changePassword = async (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password) {
    return error(res, 'Eski va yangi parol talab qilinadi');
  }
  if (new_password.length < 6) {
    return error(res, 'Yangi parol kamida 6 ta belgidan iborat bo\'lishi kerak');
  }

  try {
    const result = await pool.query(`SELECT * FROM users WHERE id = $1`, [req.user.user_id]);
    const user = result.rows[0];

    const isMatch = await bcrypt.compare(old_password, user.password_hash);
    if (!isMatch) return error(res, 'Eski parol noto\'g\'ri', 401);

    const newHash = await bcrypt.hash(new_password, 12);
    await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [newHash, req.user.user_id]
    );

    // Barcha refresh tokenlarini o'chirish
    await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [req.user.user_id]);

    return success(res, {}, 'Parol muvaffaqiyatli o\'zgartirildi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = { login, refresh, logout, changePassword };
