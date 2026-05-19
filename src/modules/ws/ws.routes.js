const express = require('express');
const router = express.Router();
const { verifyAccessToken } = require('../../utils/jwt.utils');
const { addClient } = require('./ws.manager');

/**
 * GET /ws/status
 * WebSocket server holati (oddiy HTTP endpoint)
 */
router.get('/status', (req, res) => {
  const { getClientCount } = require('./ws.manager');
  res.json({
    success: true,
    data: {
      connected_clients: getClientCount(),
      message: 'WebSocket server ishlayapti'
    }
  });
});

/**
 * WebSocket ulanishlarini HTTP Upgrade requestlari orqali qabul qilish
 * Bu funksiya server.js da app.on('upgrade', ...) bilan chaqiriladi
 *
 * Frontend: new WebSocket(`ws://host/ws?token=ACCESS_TOKEN`)
 */
const handleUpgrade = (wsServer) => (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  // Faqat /ws path uchun ishlaydi
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  const token = url.searchParams.get('token');
  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  let user;
  try {
    user = verifyAccessToken(token);
  } catch (err) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wsServer.handleUpgrade(request, socket, head, (ws) => {
    addClient(user.user_id, ws);

    // Ulanish tasdiqlash
    ws.send(JSON.stringify({
      type: 'connected',
      data: { message: 'WebSocket ulanish muvaffaqiyatli', user_id: user.user_id }
    }));

    wsServer.emit('connection', ws, request);
  });
};

module.exports = router;
module.exports.handleUpgrade = handleUpgrade;
