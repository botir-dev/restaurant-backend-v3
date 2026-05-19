const express = require('express');
const router = express.Router();
const { verifyAccessToken } = require('../../utils/jwt.utils');
const { addClient, getWss } = require('./ws.manager');

/**
 * GET /ws/status — WebSocket server holati
 */
router.get('/status', (req, res) => {
  const { getClientCount } = require('./ws.manager');
  res.json({
    success: true,
    data: { connected_clients: getClientCount(), message: 'WebSocket server ishlayapti' }
  });
});

/**
 * HTTP Upgrade handler — server.js da httpServer.on('upgrade', handleUpgrade) bilan ulanadi
 * Frontend: new WebSocket(`ws://host/ws?token=ACCESS_TOKEN`)
 */
const handleUpgrade = (request, socket, head) => {
  const wsServer = getWss();
  if (!wsServer) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    socket.destroy();
    return;
  }

  // Faqat /ws path uchun
  let pathname;
  try {
    pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  } catch (_) {
    socket.destroy();
    return;
  }

  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }

  // Token URL dan olish
  let token;
  try {
    token = new URL(request.url, `http://${request.headers.host}`).searchParams.get('token');
  } catch (_) {}

  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  // Token tekshirish
  let user;
  try {
    user = verifyAccessToken(token);
  } catch (err) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  // WebSocket handshake
  wsServer.handleUpgrade(request, socket, head, (ws) => {
    addClient(user.user_id, ws);

    // Ulanish tasdiqlash xabari
    ws.send(JSON.stringify({
      type: 'connected',
      data: { message: 'WebSocket ulanish muvaffaqiyatli', user_id: user.user_id }
    }));

    // wsServer.emit('connection') — ws.manager.js da wss.on('connection') triggerlanadi
    wsServer.emit('connection', ws, request);
  });
};

module.exports = router;
module.exports.handleUpgrade = handleUpgrade;
