const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware');
const { branchFilter } = require('../../middleware/branch.middleware');
const pool = require('../../config/database');
const { success, error } = require('../../utils/response.utils');

// GET /branches/me — Hodim o'z filiali ma'lumotini ko'rishi
router.get('/me', authenticate, branchFilter, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, address, phone FROM branches WHERE id = $1`,
      [req.user.branch_id]
    );
    if (result.rows.length === 0) return error(res, 'Filial topilmadi', 404);
    return success(res, result.rows[0]);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
});

module.exports = router;
