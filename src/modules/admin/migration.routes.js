const express = require('express');
const router = express.Router();
const pool = require('../../config/database');

/**
 * GET /admin/run-migration
 * Super admin tokenisiz — faqat MIGRATION_SECRET bilan
 * Render loglarida natijani ko'rish uchun
 */
router.get('/run-migration', async (req, res) => {
  const secret = req.query.secret;
  if (secret !== process.env.MIGRATION_SECRET) {
    return res.status(403).json({ success: false, message: 'Ruxsat yo\'q' });
  }

  const results = [];

  // 1. users.role
  try {
    const col = await pool.query(`
      SELECT udt_name FROM information_schema.columns
      WHERE table_name='users' AND column_name='role'
    `);
    results.push({ check: 'users.role udt_name', value: col.rows[0]?.udt_name });

    if (col.rows[0]?.udt_name !== 'varchar') {
      await pool.query(`
        ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(100) USING role::TEXT
      `);
      results.push({ migration: 'users.role -> VARCHAR(100)', status: 'OK' });
    } else {
      results.push({ migration: 'users.role', status: 'Already VARCHAR' });
    }
  } catch (e) {
    results.push({ migration: 'users.role', error: e.message });
  }

  // 2. products.type
  try {
    const col = await pool.query(`
      SELECT udt_name FROM information_schema.columns
      WHERE table_name='products' AND column_name='type'
    `);
    results.push({ check: 'products.type udt_name', value: col.rows[0]?.udt_name });

    if (col.rows[0]?.udt_name !== 'varchar') {
      await pool.query(`
        ALTER TABLE products ALTER COLUMN type TYPE VARCHAR(100) USING type::TEXT
      `);
      results.push({ migration: 'products.type -> VARCHAR(100)', status: 'OK' });
    } else {
      results.push({ migration: 'products.type', status: 'Already VARCHAR' });
    }
  } catch (e) {
    results.push({ migration: 'products.type', error: e.message });
  }

  // 3. users.extra_permissions
  try {
    const col = await pool.query(`
      SELECT udt_name FROM information_schema.columns
      WHERE table_name='users' AND column_name='extra_permissions'
    `);
    results.push({ check: 'users.extra_permissions udt_name', value: col.rows[0]?.udt_name });

    if (col.rows[0]?.udt_name === 'product_type') {
      await pool.query(`
        ALTER TABLE users ALTER COLUMN extra_permissions TYPE TEXT[] USING extra_permissions::TEXT[]
      `);
      results.push({ migration: 'extra_permissions -> TEXT[]', status: 'OK' });
    } else {
      results.push({ migration: 'extra_permissions', status: 'Already TEXT[]' });
    }
  } catch (e) {
    results.push({ migration: 'extra_permissions', error: e.message });
  }

  // 4. orders.status enum tekshirish (agar kerak bo'lsa)
  try {
    const col = await pool.query(`
      SELECT udt_name FROM information_schema.columns
      WHERE table_name='orders' AND column_name='status'
    `);
    results.push({ check: 'orders.status udt_name', value: col.rows[0]?.udt_name });
  } catch (e) {
    results.push({ check: 'orders.status', error: e.message });
  }

  return res.json({ success: true, results });
});

module.exports = router;
