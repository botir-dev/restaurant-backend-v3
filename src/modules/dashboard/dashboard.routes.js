const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { branchFilter } = require('../../middleware/branch.middleware');
const { getDashboard } = require('./dashboard.controller');

router.get('/', authenticate, branchFilter, authorize('manager'), getDashboard);

module.exports = router;
