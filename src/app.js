const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./modules/auth/auth.routes');
const adminRoutes = require('./modules/admin/admin.routes');
const restaurantRoutes = require('./modules/restaurants/restaurant.routes');
const branchRoutes = require('./modules/branches/branch.routes');
const staffRoutes = require('./modules/staff/staff.routes');
const productRoutes = require('./modules/products/product.routes');
const tableRoutes = require('./modules/tables/table.routes');
const orderRoutes = require('./modules/orders/order.routes');
const paymentRoutes = require('./modules/payments/payment.routes');
const archiveRoutes = require('./modules/archive/archive.routes');
const dashboardRoutes = require('./modules/dashboard/dashboard.routes');
const sseRoutes = require('./modules/sse/sse.routes');
const publicRoutes = require('./modules/public/public.routes');
const managerRoutes = require('./modules/manager/manager.routes');
const migrationRoutes = require('./modules/admin/migration.routes');

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { success: false, message: "Juda ko'p so'rov. 1 daqiqadan keyin qayta urinib ko'ring." }
});
app.use(limiter);

// Public routes (no auth)
app.use('/public', publicRoutes);
app.use('/sse', sseRoutes);

// Auth
app.use('/auth', authRoutes);

// Protected routes
app.use('/admin', adminRoutes);
app.use('/restaurants', restaurantRoutes);
app.use('/branches', branchRoutes);
app.use('/staff', staffRoutes);
app.use('/products', productRoutes);
app.use('/tables', tableRoutes);
app.use('/orders', orderRoutes);
app.use('/payments', paymentRoutes);
app.use('/archive', archiveRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/manager', managerRoutes);
app.use('/migration', migrationRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Endpoint topilmadi" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Server xatosi"
  });
});

module.exports = app;
