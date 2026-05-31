require('dotenv').config();
const http = require('http');
const fs   = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app        = require('./src/app');
const pool       = require('./src/config/database');
const { startCronJobs }  = require('./src/utils/cron.utils');
const { initWebSocket }  = require('./src/modules/ws/ws.manager');
const { handleUpgrade }  = require('./src/modules/ws/ws.routes');

const PORT = parseInt(process.env.PORT) || 3000;

const initDB = async () => {
  try {
    const check = await pool.query(`SELECT to_regclass('public.users') as exists`);
    if (!check.rows[0].exists) {
      const schema = fs.readFileSync(path.join(__dirname, 'src/config/schema.sql'), 'utf8');
      await pool.query(schema);
    }

    // Migratsiyalar
    try {
      const r = await pool.query(`SELECT udt_name FROM information_schema.columns WHERE table_name='users' AND column_name='role'`);
      if (r.rows[0]?.udt_name === 'user_role') {
        await pool.query(`ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(100) USING role::TEXT`);
      }
    } catch (_) {}

    try {
      const r = await pool.query(`SELECT udt_name FROM information_schema.columns WHERE table_name='products' AND column_name='type'`);
      if (r.rows[0]?.udt_name === 'product_type') {
        await pool.query(`ALTER TABLE products ALTER COLUMN type TYPE VARCHAR(100) USING type::TEXT`);
      }
    } catch (_) {}

    try {
      const r = await pool.query(`SELECT udt_name FROM information_schema.columns WHERE table_name='users' AND column_name='extra_permissions'`);
      if (r.rows[0]?.udt_name === 'product_type') {
        await pool.query(`ALTER TABLE users ALTER COLUMN extra_permissions TYPE TEXT[] USING extra_permissions::TEXT[]`);
      }
    } catch (_) {}

    try {
      await pool.query(`ALTER TABLE order_archive ADD COLUMN IF NOT EXISTS service_fee_percent DECIMAL(5,2) DEFAULT 0`);
      await pool.query(`ALTER TABLE order_archive ADD COLUMN IF NOT EXISTS service_fee_amount DECIMAL(12,2) DEFAULT 0`);
      await pool.query(`ALTER TABLE order_archive ADD COLUMN IF NOT EXISTS grand_total DECIMAL(12,2) DEFAULT 0`);
    } catch (_) {}

    try {
      const r = await pool.query(`SELECT udt_name FROM information_schema.columns WHERE table_name='order_archive' AND column_name='payment_type'`);
      if (r.rows[0]?.udt_name === 'payment_type') {
        await pool.query(`ALTER TABLE order_archive ALTER COLUMN payment_type TYPE VARCHAR(50) USING payment_type::TEXT`);
      }
    } catch (_) {}

    await pool.query(`CREATE TABLE IF NOT EXISTS custom_roles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
      branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      key VARCHAR(100) NOT NULL, label VARCHAR(200) NOT NULL,
      product_type_key VARCHAR(100), created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (branch_id, key)
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS custom_product_types (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
      branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      key VARCHAR(100) NOT NULL, label VARCHAR(200) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (branch_id, key)
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS branch_settings (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE UNIQUE,
      service_fee_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
      service_fee_enabled BOOLEAN DEFAULT FALSE,
      vat_percent DECIMAL(5,2) DEFAULT 0,
      vat_enabled BOOLEAN DEFAULT FALSE,
      waiter_commission_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
      role_commissions JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // branch_settings migration
    try { await pool.query(`ALTER TABLE branch_settings ADD COLUMN IF NOT EXISTS service_fee_enabled BOOLEAN DEFAULT FALSE`); } catch(_) {}
    try { await pool.query(`ALTER TABLE branch_settings ADD COLUMN IF NOT EXISTS vat_percent DECIMAL(5,2) DEFAULT 0`); } catch(_) {}
    try { await pool.query(`ALTER TABLE branch_settings ADD COLUMN IF NOT EXISTS vat_enabled BOOLEAN DEFAULT FALSE`); } catch(_) {}
    try { await pool.query(`ALTER TABLE branch_settings ADD COLUMN IF NOT EXISTS role_commissions JSONB DEFAULT \'{}\'`); } catch(_) {}

    // order_archive migration
    try { await pool.query(`ALTER TABLE order_archive ADD COLUMN IF NOT EXISTS vat_percent DECIMAL(5,2) DEFAULT 0`); } catch(_) {}
    try { await pool.query(`ALTER TABLE order_archive ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(12,2) DEFAULT 0`); } catch(_) {}

    // role_earnings jadvali
    await pool.query(`CREATE TABLE IF NOT EXISTS role_earnings (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      role VARCHAR(100),
      total_orders INTEGER NOT NULL DEFAULT 0,
      total_order_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      commission_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
      earned_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (user_id, date)
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS waiter_earnings (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      waiter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      total_orders INTEGER NOT NULL DEFAULT 0,
      total_order_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      commission_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
      earned_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (waiter_id, date)
    )`);

    // ─── SUPER ADMIN: default parol bo'lsa xato chiqar ────────
    const username = process.env.SUPER_ADMIN_USERNAME || 'superadmin';
    const password = process.env.SUPER_ADMIN_PASSWORD;

    if (!password) {
      // Production da majburiy
      if (process.env.NODE_ENV === 'production') {
        console.error('[KRITIK] SUPER_ADMIN_PASSWORD env o\'zgaruvchisi o\'rnatilmagan! Server to\'xtatilmoqda.');
        process.exit(1);
      }
      console.warn('[OGOHLANTIRISH] SUPER_ADMIN_PASSWORD o\'rnatilmagan. Development da vaqtinchalik parol ishlatilmoqda.');
    }

    const finalPassword = password || `Dev_${uuidv4().slice(0, 8)}`;

    if (process.env.RESET_SUPER_ADMIN === 'true') {
      await pool.query(`DELETE FROM users WHERE role = 'super_admin'`);
    }

    const adminCheck = await pool.query(`SELECT id FROM users WHERE role = 'super_admin' LIMIT 1`);
    if (adminCheck.rows.length === 0) {
      const hash = await bcrypt.hash(finalPassword, 12);
      await pool.query(
        `INSERT INTO users (id, full_name, username, password_hash, role) VALUES ($1,'Super Admin',$2,$3,'super_admin')`,
        [uuidv4(), username, hash]
      );
      if (!password) {
        console.log(`[DEV] Vaqtinchalik super admin paroli: ${finalPassword}`);
      }
    }

  } catch (err) {
    console.error('[initDB] DB initsializatsiya xatosi:', err.message);
    process.exit(1);
  }
};

initDB().then(() => {
  const httpServer = http.createServer(app);
  initWebSocket();
  httpServer.on('upgrade', handleUpgrade);
  httpServer.listen(PORT, () => {
    console.log(`[Server] Port ${PORT} da ishlamoqda`);
    startCronJobs();
  });
}).catch((err) => {
  console.error('[Server] Ishga tushishda xato:', err.message);
  process.exit(1);
});
