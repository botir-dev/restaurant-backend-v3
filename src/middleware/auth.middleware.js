const { verifyAccessToken } = require('../utils/jwt.utils');
const { error } = require('../utils/response.utils');
const pool = require('../config/database');

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return error(res, 'Token taqdim etilmagan', 401);
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch (err) {
    return error(res, 'Token noto\'g\'ri yoki muddati o\'tgan', 401);
  }
};

// Standart rollar ro'yxati
const STANDARD_PREPARER_ROLES = [
  'cook', 'baker', 'somsa_maker', 'grill_master',
  'turkish_cook', 'bartender', 'icecream_maker', 'tea_master'
];
const NON_PREPARER_ROLES = ['manager', 'waiter', 'cashier', 'storekeeper', 'super_admin'];

// authorize — standart rollarni tekshiradi + custom rollarni qo'shimcha tekshirish
const authorize = (...roles) => {
  return async (req, res, next) => {
    const userRole = req.user.role;

    // To'g'ridan-to'g'ri ro'yxatda bo'lsa — ruxsat
    if (roles.includes(userRole)) return next();

    // Custom rol bo'lishi mumkin — DB dan tekshiramiz
    // Agar roles ichida tayyorlovchi rollar bo'lsa va user custom rol bo'lsa
    const hasPreparer = roles.some(r => STANDARD_PREPARER_ROLES.includes(r));
    const isCustomRole = !NON_PREPARER_ROLES.includes(userRole) &&
                         !STANDARD_PREPARER_ROLES.includes(userRole);

    if (hasPreparer && isCustomRole && req.user.branch_id) {
      try {
        const result = await pool.query(
          `SELECT id FROM custom_roles WHERE key = $1 AND branch_id = $2`,
          [userRole, req.user.branch_id]
        );
        if (result.rows.length > 0) return next();
      } catch (e) {
        console.error('authorize custom role check error:', e.message);
      }
    }

    return error(res, 'Ruxsat yo\'q', 403);
  };
};

const superAdminOnly = authorize('super_admin');
const managerOrAdmin = authorize('super_admin', 'manager');

module.exports = { authenticate, authorize, superAdminOnly, managerOrAdmin };
