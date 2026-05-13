const { verifyAccessToken } = require('../utils/jwt.utils');
const { error } = require('../utils/response.utils');

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

// Rollarni tekshirish
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return error(res, 'Ruxsat yo\'q', 403);
    }
    next();
  };
};

// Super admin
const superAdminOnly = authorize('super_admin');

// Manager yoki super admin
const managerOrAdmin = authorize('super_admin', 'manager');

module.exports = { authenticate, authorize, superAdminOnly, managerOrAdmin };
