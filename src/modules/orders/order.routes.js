const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { branchFilter } = require('../../middleware/branch.middleware');
const c = require('./order.controller');

router.use(authenticate, branchFilter);

router.get('/', authorize(
  'manager', 'waiter', 'cashier', 'cook', 'baker',
  'somsa_maker', 'grill_master', 'turkish_cook',
  'bartender', 'icecream_maker', 'tea_master'
), c.getOrders);

router.post('/', authorize('waiter'), c.createOrder);
router.put('/:id', authorize('waiter', 'manager'), c.updateOrder);
router.patch('/:id/send', authorize('waiter'), c.sendToKitchen);
router.patch('/:id/complete', authorize('waiter'), c.completeOrder);
router.patch('/:id/items/:itemId/prepare', authorize(
  'cook', 'baker', 'somsa_maker', 'grill_master',
  'turkish_cook', 'bartender', 'icecream_maker', 'tea_master'
), c.prepareItem);
router.delete('/:id', authorize('waiter', 'manager'), c.cancelOrder);

module.exports = router;
