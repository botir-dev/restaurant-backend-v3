const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes      = require('./modules/auth/auth.routes');
const adminRoutes     = require('./modules/admin/admin.routes');
const restaurantRoutes= require('./modules/restaurants/restaurant.routes');
const branchRoutes    = require('./modules/branches/branch.routes');
const staffRoutes     = require('./modules/staff/staff.routes');
const productRoutes   = require('./modules/products/product.routes');
const tableRoutes     = require('./modules/tables/table.routes');
const orderRoutes     = require('./modules/orders/order.routes');
const paymentRoutes   = require('./modules/payments/payment.routes');
const archiveRoutes   = require('./modules/archive/archive.routes');
const dashboardRoutes = require('./modules/dashboard/dashboard.routes');
const wsRoutes        = require('./modules/ws/ws.routes');
const publicRoutes    = require('./modules/public/public.routes');
const managerRoutes   = require('./modules/manager/manager.routes');
// migration.routes — PRODUCTION DA O'CHIRILDI (xavfsizlik)

const app = express();

// ─── HELMET + CSP ─────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ─── CORS: faqat ruxsat etilgan domenlar ──────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3001', 'http://localhost:3000', 'https://restaurant.botirdev.uz'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin && process.env.NODE_ENV !== 'production') return callback(null, true);
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS: ruxsat etilmagan manba'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── LOGGING: WS token URL da ko'rinmasin ─────────────────────
if (process.env.NODE_ENV === 'production') {
  morgan.token('safe-url', (req) => req.url.replace(/token=[^&\s]*/g, 'token=***'));
  app.use(morgan(':method :safe-url :status :res[content-length] - :response-time ms'));
} else {
  app.use(morgan('dev'));
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── GLOBAL RATE LIMIT ────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Juda ko'p so'rov. 1 daqiqadan keyin qayta urinib ko'ring." },
});
app.use(globalLimiter);

// ─── LOGIN BRUTE FORCE LIMITI (alohida) ───────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Juda ko'p noto'g'ri urinish. 15 daqiqadan keyin urinib ko'ring." },
});
app.use('/auth/login', loginLimiter);

// ─── QR PUBLIC BUYURTMA LIMITI (IP bo'yicha) ──────────────────
const publicOrderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Juda tez-tez buyurtma. Biroz kuting." },
});
app.use('/public/orders', publicOrderLimiter);

// ─── ROUTLAR ──────────────────────────────────────────────────
app.use('/public',      publicRoutes);
app.use('/ws',          wsRoutes);
app.use('/auth',        authRoutes);
app.use('/admin',       adminRoutes);
app.use('/restaurants', restaurantRoutes);
app.use('/branches',    branchRoutes);
app.use('/staff',       staffRoutes);
app.use('/products',    productRoutes);
app.use('/tables',      tableRoutes);
app.use('/orders',      orderRoutes);
app.use('/payments',    paymentRoutes);
app.use('/archive',     archiveRoutes);
app.use('/dashboard',   dashboardRoutes);
app.use('/manager',     managerRoutes);

// ─── 404 ──────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint topilmadi' });
});

// ─── GLOBAL ERROR HANDLER ─────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.message && err.message.startsWith('CORS')) {
    return res.status(403).json({ success: false, message: err.message });
  }
  const isDev = process.env.NODE_ENV !== 'production';
  const message = isDev ? (err.message || 'Server xatosi') : 'Server xatosi';
  if (isDev) console.error('[ERROR]', err);
  res.status(err.status || 500).json({ success: false, message });
});

module.exports = app;
