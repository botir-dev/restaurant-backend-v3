const { error } = require('../utils/response.utils');

const branchFilter = (req, res, next) => {
  if (!req.user) return error(res, 'Autentifikatsiya talab qilinadi', 401);

  if (req.user.role === 'super_admin') {
    // super_admin query yoki body dan branch_id/restaurant_id berishi mumkin
    req.branchId     = req.query.branch_id     || req.body?.branch_id     || null;
    req.restaurantId = req.query.restaurant_id || req.body?.restaurant_id || null;
  } else if (req.user.role === 'owner') {
    // Owner branch_id siz ishlaydi — restaurant_id token dan, branch_id query/params dan
    req.restaurantId = req.user.restaurant_id;
    req.branchId     = req.query.branch_id || req.body?.branch_id || null;
  } else {
    req.restaurantId = req.user.restaurant_id;
    req.branchId     = req.user.branch_id;
  }
  next();
};

// Endpointlar uchun branch_id majburiy bo'lgan holat
const requireBranch = (req, res, next) => {
  if (!req.branchId) {
    return error(res, 'branch_id talab qilinadi', 400);
  }
  next();
};

module.exports = { branchFilter, requireBranch };
