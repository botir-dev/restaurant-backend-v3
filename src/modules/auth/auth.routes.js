const express = require('express');
const router = express.Router();
const { login, refresh, logout, changePassword } = require('./auth.controller');
const { authenticate } = require('../../middleware/auth.middleware');

router.post('/login', login);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.put('/change-password', authenticate, changePassword);

module.exports = router;
