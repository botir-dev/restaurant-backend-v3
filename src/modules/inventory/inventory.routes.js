const router = require('express').Router();
const { authenticate } = require('../../middleware/auth.middleware');
const { branchFilter }  = require('../../middleware/branch.middleware');
const {
  getInventory, createInventoryItem, updateInventoryItem,
  addStock, deleteInventoryItem, getInventoryLogs
} = require('./inventory.controller');

const ALLOWED = ['manager', 'storekeeper', 'super_admin'];
const canManage = (req, res, next) => {
  if (!ALLOWED.includes(req.user.role))
    return res.status(403).json({ success: false, message: 'Ruxsat yo\'q' });
  next();
};

router.use(authenticate, branchFilter);

router.get('/',          getInventory);
router.get('/logs',      canManage, getInventoryLogs);
router.post('/',         canManage, createInventoryItem);
router.put('/:id',       canManage, updateInventoryItem);
router.patch('/:id/add', canManage, addStock);
router.delete('/:id',    canManage, deleteInventoryItem);

module.exports = router;
