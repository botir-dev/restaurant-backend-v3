const router = require('express').Router();
const { authenticate } = require('../../middleware/auth.middleware');
const { branchFilter }  = require('../../middleware/branch.middleware');
const { requireFeature } = require('../../middleware/tariff.middleware');
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

router.get('/',          requireFeature('inventory'), getInventory);
router.get('/logs',      requireFeature('inventory'), canManage, getInventoryLogs);
router.post('/',         requireFeature('inventory'), canManage, createInventoryItem);
router.put('/:id',       requireFeature('inventory'), canManage, updateInventoryItem);
router.patch('/:id/add', requireFeature('inventory'), canManage, addStock);
router.delete('/:id',    requireFeature('inventory'), canManage, deleteInventoryItem);

module.exports = router;
