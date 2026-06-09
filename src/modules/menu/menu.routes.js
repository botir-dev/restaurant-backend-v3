const router = require('express').Router();
const { authenticate } = require('../../middleware/auth.middleware');
const { branchFilter }  = require('../../middleware/branch.middleware');
const {
  getMenuItems, createMenuItem, updateMenuItem,
  deleteMenuItem, toggleMenuAvailability
} = require('./menu.controller');
const { isPreparerRole, getAllowedTypes } = require('../../utils/roles.utils');
const { requireFeature } = require('../../middleware/tariff.middleware');

const CAN_MANAGE = ['manager', 'storekeeper', 'super_admin'];
const canManage = (req, res, next) => {
  if (!CAN_MANAGE.includes(req.user.role))
    return res.status(403).json({ success: false, message: "Ruxsat yo'q" });
  next();
};

// Manager/storekeeper/super_admin YOKI o'z mahsulot turiga ega tayyorlovchi
const canToggleAvailability = async (req, res, next) => {
  if (CAN_MANAGE.includes(req.user.role)) return next();

  if (isPreparerRole(req.user.role)) {
    const { role, extra_permissions } = req.user;
    const allowedTypes = await getAllowedTypes(role, extra_permissions, req.branchId);
    if (allowedTypes.length > 0) {
      const pool = require('../../config/database');
      try {
        const item = await pool.query(
          `SELECT type FROM menu_items WHERE id = $1 AND branch_id = $2`,
          [req.params.id, req.branchId]
        );
        if (item.rows.length === 0)
          return res.status(404).json({ success: false, message: 'Topilmadi' });
        if (allowedTypes.includes(item.rows[0].type)) return next();
      } catch (_) {}
    }
  }

  return res.status(403).json({ success: false, message: "Ruxsat yo'q" });
};

router.use(authenticate, branchFilter);

router.get('/',                      requireFeature('menu_management'), getMenuItems);
router.post('/',                     requireFeature('menu_management'), canManage, createMenuItem);
router.put('/:id',                   requireFeature('menu_management'), canManage, updateMenuItem);
router.delete('/:id',                requireFeature('menu_management'), canManage, deleteMenuItem);
router.patch('/:id/availability',    requireFeature('menu_management'), canToggleAvailability, toggleMenuAvailability);

module.exports = router;
