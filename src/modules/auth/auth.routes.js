const express = require('express');
const router = express.Router();
const { login, verifyOtp, refresh, logout, logoutAll, changePassword } = require('./auth.controller');
const { authenticate } = require('../../middleware/auth.middleware');

router.post('/login',           login);
router.post('/verify-otp',      verifyOtp);
router.post('/refresh',         refresh);
router.post('/logout',          logout);
router.post('/logout-all',      authenticate, logoutAll);
router.put('/change-password',  authenticate, changePassword);

module.exports = router;
