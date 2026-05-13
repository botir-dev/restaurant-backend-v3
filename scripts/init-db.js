require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : new Pool({
      host: process.env.DB_HOST, port: process.env.DB_PORT,
      database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    });

const schema = fs.readFileSync(path.join(__dirname, '../src/config/schema.sql'), 'utf8');

pool.query(schema)
  .then(() => { console.log('Sxema muvaffaqiyatli yaratildi'); process.exit(0); })
  .catch(err => { console.error('Xato:', err.message); process.exit(1); });
