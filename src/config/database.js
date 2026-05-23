const { Pool } = require('pg');

// SSL konfiguratsiyasi muhitga qarab
const getSslConfig = () => {
  if (process.env.NODE_ENV !== 'production') return false;
  // Production da sertifikat tekshiriladi
  if (process.env.DB_SSL_CERT) {
    return { rejectUnauthorized: true, ca: process.env.DB_SSL_CERT };
  }
  // Render.com kabi yopiq platformalar uchun
  if (process.env.DB_SSL_NO_VERIFY === 'true') {
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true };
};

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: getSslConfig(),
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  : new Pool({
      host:     process.env.DB_HOST,
      port:     parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME,
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl:      getSslConfig(),
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') console.log('PostgreSQL ga ulandi');
});

pool.on('error', (err) => {
  // Production da xato tafsilotlarini log ga chiqarmaslik
  if (process.env.NODE_ENV === 'production') {
    console.error('PostgreSQL connection error');
  } else {
    console.error('PostgreSQL xatosi:', err.message);
  }
});

module.exports = pool;
