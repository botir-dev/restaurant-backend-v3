const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { branchFilter } = require('../../middleware/branch.middleware');
const c = require('./table.controller');

router.use(authenticate, branchFilter);

router.get('/', c.getTables);
router.post('/', authorize('manager'), c.createTable);
router.patch('/:id/occupy', authorize('waiter'), c.occupyTable);
router.patch('/:id/free', authorize('waiter', 'manager'), c.freeTable);

router.get('/reservations', authorize('waiter', 'manager'), c.getReservations);
router.post('/reservations', authorize('waiter', 'manager'), c.createReservation);
router.delete('/reservations/:id', authorize('waiter', 'manager'), c.cancelReservation);

module.exports = router;
