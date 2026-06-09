const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { branchFilter } = require('../../middleware/branch.middleware');
const { requireFeature } = require('../../middleware/tariff.middleware');
const { getDashboard } = require('./dashboard.controller');

router.get('/', authenticate, branchFilter, authorize('manager'), requireFeature('advanced_reports'), getDashboard);

module.exports = router;
