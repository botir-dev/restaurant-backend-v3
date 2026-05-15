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
    const check = await pool.query(`SELECT to_regclass('public.users') as exists`);

    if (!check.rows[0].exists) {
      const schema = fs.readFileSync(path.join(__dirname, 'src/config/schema.sql'), 'utf8');
      await pool.query(schema);
      console.log('DB sxemasi muvaffaqiyatli yaratildi');
    } else {
      console.log('DB sxemasi allaqachon mavjud');
    }

    const username = process.env.SUPER_ADMIN_USERNAME || 'superadmin';
    const password = process.env.SUPER_ADMIN_PASSWORD || 'Admin@12345';

    // RESET_SUPER_ADMIN=true bo'lsa — eski adminni o'chirib qayta yaratish
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
  }
};

app.listen(PORT, async () => {
  console.log(`Server ${PORT}-portda ishlamoqda`);
  await initDB();
  startCronJobs();
});
