const express = require('express');
const router = express.Router();
const { authenticate, managerOrAdmin } = require('../../middleware/auth.middleware');
const { branchFilter } = require('../../middleware/branch.middleware');
const pool = require('../../config/database');
const { success, error } = require('../../utils/response.utils');

// GET /restaurants/me — Hodim o'z restoran ma'lumotini ko'rishi
router.get('/me', authenticate, branchFilter, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.name, r.address, r.logo_url FROM restaurants r WHERE r.id = $1`,
      [req.user.restaurant_id]
    );
    if (result.rows.length === 0) return error(res, 'Restoran topilmadi', 404);
    return success(res, result.rows[0]);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
});

module.exports = router;
