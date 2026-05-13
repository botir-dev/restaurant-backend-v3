const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { branchFilter } = require('../../middleware/branch.middleware');
const c = require('./product.controller');

router.use(authenticate, branchFilter);

router.get('/', c.getProducts);
router.post('/', authorize('manager', 'storekeeper'), c.createProduct);
router.put('/:id', authorize('manager', 'storekeeper'), c.updateProduct);
router.delete('/:id', authorize('manager', 'storekeeper'), c.deleteProduct);
router.patch('/:id/availability', authorize(
  'manager', 'storekeeper', 'cook', 'baker', 'somsa_maker',
  'grill_master', 'turkish_cook', 'bartender', 'icecream_maker', 'tea_master'
), c.toggleAvailability);

module.exports = router;
