require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const app = require('./src/app');
const pool = require('./src/config/database');
const { startCronJobs } = require('./src/utils/cron.utils');

const PORT = process.env.PORT || 3000;

const initDB = async () => {
  try {
    // 1. Asosiy sxema
    const check = await pool.query(`SELECT to_regclass('public.users') as exists`);
    if (!check.rows[0].exists) {
      const schema = fs.readFileSync(path.join(__dirname, 'src/config/schema.sql'), 'utf8');
      await pool.query(schema);
      console.log('DB sxemasi muvaffaqiyatli yaratildi');
    } else {
      console.log('DB sxemasi allaqachon mavjud');
    }

    // 2. Yangi jadvallarni qo'shish — har safar tekshiriladi
    await pool.query(`
      CREATE TABLE IF NOT EXISTS custom_roles (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        branch_id     UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        key           VARCHAR(100) NOT NULL,
        label         VARCHAR(200) NOT NULL,
        product_type_key VARCHAR(100),
        created_at    TIMESTAMP DEFAULT NOW(),
        UNIQUE (branch_id, key)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS custom_product_types (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        branch_id     UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        key           VARCHAR(100) NOT NULL,
        label         VARCHAR(200) NOT NULL,
        created_at    TIMESTAMP DEFAULT NOW(),
        UNIQUE (branch_id, key)
      )
    `);
    console.log('Qo\'shimcha jadvallar tekshirildi');

    // 3. Super admin
    const username = process.env.SUPER_ADMIN_USERNAME || 'superadmin';
    const password = process.env.SUPER_ADMIN_PASSWORD || 'Admin@12345';

    if (process.env.RESET_SUPER_ADMIN === 'true') {
      await pool.query(`DELETE FROM users WHERE role = 'super_admin'`);
      console.log('Eski super admin o\'chirildi');
    }

    const adminCheck = await pool.query(
      `SELECT id FROM users WHERE role = 'super_admin' LIMIT 1`
    );

    if (adminCheck.rows.length === 0) {
      const passwordHash = await bcrypt.hash(password, 12);
      await pool.query(
        `INSERT INTO users (id, full_name, username, password_hash, role)
         VALUES ($1, 'Super Admin', $2, $3, 'super_admin')`,
        [uuidv4(), username, passwordHash]
      );
      console.log('=================================');
      console.log('Super admin yaratildi!');
      console.log(`Username: ${username}`);
      console.log(`Password: ${password}`);
      console.log('=================================');
    } else {
      console.log('Super admin allaqachon mavjud');
    }

  } catch (err) {
    console.error('DB init xatosi:', err.message);
    process.exit(1); // Jiddiy xato bo'lsa serverni to'xtatamiz
  }
};

// initDB LISTEN DAN OLDIN ishlaydi — server so'rov qabul qilishdan oldin DB tayyor bo'ladi
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server ${PORT}-portda ishlamoqda`);
    startCronJobs();
  });
});
