const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { branchFilter } = require('../../middleware/branch.middleware');
const c = require('./staff.controller');

router.use(authenticate, branchFilter, authorize('manager'));

router.get('/', c.getStaff);
router.post('/', c.createStaff);
router.put('/:id', c.updateStaff);
router.delete('/:id', c.deleteStaff);

module.exports = router;
