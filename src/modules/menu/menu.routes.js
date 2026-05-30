const router = require('express').Router();
const auth   = require('../../middleware/auth.middleware');
const branch = require('../../middleware/branch.middleware');
const {
  getMenuItems, createMenuItem, updateMenuItem,
  deleteMenuItem, toggleMenuAvailability
} = require('./menu.controller');

const CAN_MANAGE = ['manager', 'storekeeper', 'super_admin'];
const canManage = (req, res, next) => {
  if (!CAN_MANAGE.includes(req.user.role))
    return res.status(403).json({ success: false, message: "Ruxsat yo'q" });
  next();
};

router.use(auth, branch);

router.get('/',                      getMenuItems);
router.post('/',                     canManage, createMenuItem);
router.put('/:id',                   canManage, updateMenuItem);
router.delete('/:id',                canManage, deleteMenuItem);
router.patch('/:id/availability',    canManage, toggleMenuAvailability);

module.exports = router;
