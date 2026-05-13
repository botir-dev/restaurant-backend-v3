const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { branchFilter } = require('../../middleware/branch.middleware');
const c = require('./archive.controller');

router.use(authenticate, branchFilter, authorize('manager'));

router.get('/', c.getArchive);
router.get('/revenue', c.getRevenue);

module.exports = router;
