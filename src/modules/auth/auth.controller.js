const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../../utils/jwt.utils');
const { success, error } = require('../../utils/response.utils');
const { sendTelegramMessage } = require('../../utils/telegram');

const parsePermissions = (val) => {
  if (!val || val === '{}') return [];
  if (Array.isArray(val)) return val;
  return val.replace(/^{|}$/g, '').split(',').filter(Boolean);
};

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'none',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

// 6 raqamli kod generatsiya
const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

// Vaqtinchalik OTP larni xotirada saqlash (production da Redis ishlatish mumkin)
// { key: `otp:${userId}` → { code, expires, userData } }
const otpStore = new Map();

// POST /auth/login
const login = async (req, res) => {
  const { username, password, device_token } = req.body;
  if (!username || !password) {
    return error(res, 'Username va parol talab qilinadi');
  }
  if (typeof password !== 'string' || password.length > 128) {
    return error(res, "Parol noto'g'ri formatda");
  }

  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE username = $1 AND is_active = TRUE`,
      [username]
    );
    if (result.rows.length === 0) {
      await bcrypt.hash('dummy', 12);
      return error(res, "Username yoki parol noto'g'ri", 401);
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return error(res, "Username yoki parol noto'g'ri", 401);
    }

    // ── 2FA tekshiruvi ────────────────────────────────────────
    if (user.telegram_chat_id) {
      // Qurilma ishonchli ekanligini tekshirish
      if (device_token) {
        const deviceCheck = await pool.query(
          `SELECT id FROM trusted_devices
           WHERE user_id = $1 AND device_token = $2 AND expires_at > NOW()`,
          [user.id, device_token]
        );
        if (deviceCheck.rows.length > 0) {
          // Ishonchli qurilma — 2FA siz login
          return await issueTokens(res, user);
        }
      }

      // OTP yuborish
      const otp = generateOtp();
      const otpKey = `otp:${user.id}`;
      otpStore.set(otpKey, {
        code: otp,
        expires: Date.now() + 5 * 60 * 1000, // 5 daqiqa
        userData: user,
      });

      // Eski OTP larni tozalash (10 daqiqada bir)
      setTimeout(() => {
        const entry = otpStore.get(otpKey);
        if (entry && entry.expires < Date.now()) otpStore.delete(otpKey);
      }, 10 * 60 * 1000);

      try {
        await sendTelegramMessage(
          user.telegram_chat_id,
          `🔐 <b>Kirish kodi</b>\n\nKod: <b>${otp}</b>\n\nUshbu kod 5 daqiqa davomida amal qiladi.\nAgar siz kirmoqchi bo'lmagan bo'lsangiz, parolingizni o'zgartiring!`
        );
      } catch (e) {
        console.error('[2FA] Telegram xabar yuborishda xato:', e.message);
        return error(res, 'Telegram xabar yuborishda xato. Chat ID ni tekshiring.', 500);
      }

      return success(res, {
        requires_2fa: true,
        user_id: user.id,
        message: 'Telegram ga kod yuborildi',
      }, '2FA kodi yuborildi');
    }

    // telegram_chat_id yo'q — to'g'ridan login
    return await issueTokens(res, user);

  } catch (err) {
    console.error('[login]', err.message);
    return error(res, 'Server xatosi', 500);
  }
};

// POST /auth/verify-otp
const verifyOtp = async (req, res) => {
  const { user_id, code, trust_device } = req.body;
  if (!user_id || !code) {
    return error(res, 'user_id va code talab qilinadi');
  }

  const otpKey = `otp:${user_id}`;
  const entry = otpStore.get(otpKey);

  if (!entry) {
    return error(res, 'Kod topilmadi yoki muddati o\'tgan. Qayta login qiling.', 400);
  }
  if (Date.now() > entry.expires) {
    otpStore.delete(otpKey);
    return error(res, 'Kod muddati o\'tgan. Qayta login qiling.', 400);
  }
  if (entry.code !== String(code).trim()) {
    return error(res, 'Kod noto\'g\'ri', 400);
  }

  otpStore.delete(otpKey);
  const user = entry.userData;

  // Qurilmani eslab qolish
  let deviceToken = null;
  if (trust_device) {
    deviceToken = uuidv4();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 kun
    const userAgent = req.headers['user-agent'] || '';
    await pool.query(
      `INSERT INTO trusted_devices (id, user_id, device_token, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), user.id, deviceToken, userAgent, expiresAt]
    );
  }

  return await issueTokens(res, user, deviceToken);
};

// Token berish — ichki yordamchi funksiya
const issueTokens = async (res, user, deviceToken = null) => {
  const extraPerms = parsePermissions(user.extra_permissions);

  // Custom rol uchun product_type_key ni DB dan olish
  const STANDARD_ROLES = [
    'manager', 'waiter', 'cashier', 'storekeeper', 'super_admin',
    'cook', 'baker', 'somsa_maker', 'grill_master',
    'turkish_cook', 'bartender', 'icecream_maker', 'tea_master'
  ];
  let productTypeKey = null;
  if (!STANDARD_ROLES.includes(user.role) && user.branch_id) {
    try {
      const cr = await pool.query(
        `SELECT product_type_key FROM custom_roles WHERE key = $1 AND branch_id = $2`,
        [user.role, user.branch_id]
      );
      productTypeKey = cr.rows[0]?.product_type_key || null;
    } catch (_) {}
  }

  const payload = {
    user_id: user.id,
    full_name: user.full_name,
    role: user.role,
    restaurant_id: user.restaurant_id,
    branch_id: user.branch_id,
    extra_permissions: extraPerms,
    ...(productTypeKey ? { product_type_key: productTypeKey } : {}),
  };

  const accessToken  = generateAccessToken(payload);
  const refreshToken = generateRefreshToken({ user_id: user.id });

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)`,
    [uuidv4(), user.id, refreshToken, expiresAt]
  );

  res.cookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTIONS);

  return success(res, {
    access_token: accessToken,
    role: user.role,
    extra_permissions: extraPerms,
    branch_id: user.branch_id,
    restaurant_id: user.restaurant_id,
    full_name: user.full_name,
    ...(productTypeKey ? { product_type_key: productTypeKey } : {}),
    ...(deviceToken ? { device_token: deviceToken } : {}),
  }, 'Muvaffaqiyatli kirildi');
};

// POST /auth/refresh
const refresh = async (req, res) => {
  const refreshToken = req.cookies?.refresh_token || req.body?.refresh_token;
  if (!refreshToken) return error(res, 'Refresh token talab qilinadi', 401);

  try {
    const payload = verifyRefreshToken(refreshToken);

    const tokenResult = await pool.query(
      `SELECT * FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()`,
      [refreshToken]
    );
    if (tokenResult.rows.length === 0) {
      res.clearCookie('refresh_token', { path: '/' });
      return error(res, "Token noto'g'ri yoki muddati o'tgan", 401);
    }

    await pool.query(`DELETE FROM refresh_tokens WHERE token = $1`, [refreshToken]);

    const userResult = await pool.query(
      `SELECT * FROM users WHERE id = $1 AND is_active = TRUE`,
      [payload.user_id]
    );
    if (userResult.rows.length === 0) {
      res.clearCookie('refresh_token', { path: '/' });
      return error(res, 'Foydalanuvchi topilmadi', 401);
    }

    const user = userResult.rows[0];
    const refreshExtraPerms = parsePermissions(user.extra_permissions);
    let refreshProductTypeKey = null;
    const STANDARD_ROLES_R = [
      'manager', 'waiter', 'cashier', 'storekeeper', 'super_admin',
      'cook', 'baker', 'somsa_maker', 'grill_master',
      'turkish_cook', 'bartender', 'icecream_maker', 'tea_master'
    ];
    if (!STANDARD_ROLES_R.includes(user.role) && user.branch_id) {
      try {
        const cr = await pool.query(
          `SELECT product_type_key FROM custom_roles WHERE key = $1 AND branch_id = $2`,
          [user.role, user.branch_id]
        );
        refreshProductTypeKey = cr.rows[0]?.product_type_key || null;
      } catch (_) {}
    }
    const newPayload = {
      user_id: user.id,
      full_name: user.full_name,
      role: user.role,
      restaurant_id: user.restaurant_id,
      branch_id: user.branch_id,
      extra_permissions: refreshExtraPerms,
      ...(refreshProductTypeKey ? { product_type_key: refreshProductTypeKey } : {}),
    };

    const newAccessToken  = generateAccessToken(newPayload);
    const newRefreshToken = generateRefreshToken({ user_id: user.id });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)`,
      [uuidv4(), user.id, newRefreshToken, expiresAt]
    );

    res.cookie('refresh_token', newRefreshToken, REFRESH_COOKIE_OPTIONS);

    return success(res, { access_token: newAccessToken }, 'Token yangilandi');

  } catch (err) {
    res.clearCookie('refresh_token', { path: '/' });
    return error(res, "Token noto'g'ri yoki muddati o'tgan", 401);
  }
};

// POST /auth/logout
const logout = async (req, res) => {
  const refreshToken = req.cookies?.refresh_token || req.body?.refresh_token;
  if (refreshToken) {
    await pool.query(`DELETE FROM refresh_tokens WHERE token = $1`, [refreshToken]);
  }
  res.clearCookie('refresh_token', { path: '/' });
  return success(res, {}, 'Chiqildi');
};

// POST /auth/logout-all
const logoutAll = async (req, res) => {
  try {
    await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [req.user.user_id]);
    await pool.query(`DELETE FROM trusted_devices WHERE user_id = $1`, [req.user.user_id]);
    res.clearCookie('refresh_token', { path: '/' });
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
  if (new_password.length < 8) {
    return error(res, "Yangi parol kamida 8 ta belgidan iborat bo'lishi kerak");
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

    await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [req.user.user_id]);
    await pool.query(`DELETE FROM trusted_devices WHERE user_id = $1`, [req.user.user_id]);
    res.clearCookie('refresh_token', { path: '/' });

    return success(res, {}, "Parol muvaffaqiyatli o'zgartirildi");
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = { login, verifyOtp, refresh, logout, logoutAll, changePassword };
