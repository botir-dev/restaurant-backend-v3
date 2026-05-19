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

// Barcha authenticated hodimlar custom rollarni ko'ra oladi
router.get('/custom-roles', async (req, res) => {
  const pool = require('../../config/database');
  const { success, error } = require('../../utils/response.utils');
  try {
    const result = await pool.query(
      `SELECT * FROM custom_roles WHERE branch_id = $1 ORDER BY created_at ASC`,
      [req.branchId]
    );
    return success(res, result.rows);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
});

module.exports = router;
