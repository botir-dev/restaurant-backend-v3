require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const app = require('./src/app');
const pool = require('./src/config/database');
const { startCronJobs } = require('./src/utils/cron.utils');
const { initWebSocket } = require('./src/modules/ws/ws.manager');
const { handleUpgrade } = require('./src/modules/ws/ws.routes');

const PORT = process.env.PORT || 3000;

const initDB = async () => {
  try {
    const check = await pool.query(`SELECT to_regclass('public.users') as exists`);
    if (!check.rows[0].exists) {
      const schema = fs.readFileSync(path.join(__dirname, 'src/config/schema.sql'), 'utf8');
      await pool.query(schema);
      console.log('DB sxemasi yaratildi');
    } else {
      console.log('DB sxemasi mavjud');
    }

    // MIGRATION: users.role ENUM -> TEXT
    try {
      const roleCol = await pool.query(`SELECT udt_name FROM information_schema.columns WHERE table_name='users' AND column_name='role'`);
      if (roleCol.rows[0]?.udt_name === 'user_role') {
        await pool.query(`ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(100) USING role::TEXT`);
        console.log('Migration: users.role -> VARCHAR(100)');
      }
    } catch (e) { console.log('users.role migration:', e.message); }

    // MIGRATION: products.type ENUM -> TEXT
    try {
      const typeCol = await pool.query(`SELECT udt_name FROM information_schema.columns WHERE table_name='products' AND column_name='type'`);
      if (typeCol.rows[0]?.udt_name === 'product_type') {
        await pool.query(`ALTER TABLE products ALTER COLUMN type TYPE VARCHAR(100) USING type::TEXT`);
        console.log('Migration: products.type -> VARCHAR(100)');
      }
    } catch (e) { console.log('products.type migration:', e.message); }

    // MIGRATION: extra_permissions ARRAY -> TEXT[]
    try {
      const permCol = await pool.query(`SELECT udt_name FROM information_schema.columns WHERE table_name='users' AND column_name='extra_permissions'`);
      if (permCol.rows[0]?.udt_name === 'product_type') {
        await pool.query(`ALTER TABLE users ALTER COLUMN extra_permissions TYPE TEXT[] USING extra_permissions::TEXT[]`);
        console.log('Migration: extra_permissions -> TEXT[]');
      }
    } catch (e) { console.log('extra_permissions migration:', e.message); }

    // Yangi jadvallar
    await pool.query(`
      CREATE TABLE IF NOT EXISTS custom_roles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        key VARCHAR(100) NOT NULL,
        label VARCHAR(200) NOT NULL,
        product_type_key VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (branch_id, key)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS custom_product_types (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        key VARCHAR(100) NOT NULL,
        label VARCHAR(200) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (branch_id, key)
      )
    `);

    // Super admin
    const username = process.env.SUPER_ADMIN_USERNAME || 'superadmin';
    const password = process.env.SUPER_ADMIN_PASSWORD || 'Admin@12345';

    if (process.env.RESET_SUPER_ADMIN === 'true') {
      await pool.query(`DELETE FROM users WHERE role = 'super_admin'`);
    }

    const adminCheck = await pool.query(`SELECT id FROM users WHERE role = 'super_admin' LIMIT 1`);
    if (adminCheck.rows.length === 0) {
      const passwordHash = await bcrypt.hash(password, 12);
      await pool.query(
        `INSERT INTO users (id, full_name, username, password_hash, role) VALUES ($1,'Super Admin',$2,$3,'super_admin')`,
        [uuidv4(), username, passwordHash]
      );
      console.log(`Super admin yaratildi: ${username}`);
    }

  } catch (err) {
    console.error('DB init xatosi:', err.message);
    process.exit(1);
  }
};

initDB().then(() => {
  const httpServer = http.createServer(app);

  // WebSocket serverini ishga tushirish (noServer mode)
  initWebSocket();

  // HTTP Upgrade so'rovlarini WebSocket ga yo'naltirish
  httpServer.on('upgrade', handleUpgrade);

  httpServer.listen(PORT, () => {
    console.log(`Server ${PORT}-portda ishlamoqda`);
    console.log(`WebSocket: ws://localhost:${PORT}/ws?token=ACCESS_TOKEN`);
    startCronJobs();
  });
});
