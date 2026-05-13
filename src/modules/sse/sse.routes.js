const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware');
const { addClient, removeClient } = require('./sse.manager');

/**
 * GET /sse/connect
 * Hodim SSE orqali real-time xabarlarga ulanadi
 */
router.get('/connect', authenticate, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx buffering o'chirish
  res.flushHeaders();

  const userId = req.user.user_id;
  addClient(userId, res);

  // Ulanish tasdiqlash
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ message: 'SSE ulanish muvaffaqiyatli' })}\n\n`);

  // Heartbeat — ulanish uzilmasligi uchun har 30 soniyada
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (_) {
      clearInterval(heartbeat);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeClient(userId);
  });
});

module.exports = router;
