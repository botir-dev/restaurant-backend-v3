const express = require('express');
const router  = express.Router();
const { verifyAccessToken } = require('../../utils/jwt.utils');
const { addClient, getWss, getClientCount } = require('./ws.manager');

router.get('/status', (req, res) => {
  res.json({ success: true, data: { connected_clients: getClientCount() } });
});

const handleUpgrade = (request, socket, head) => {
  const wsServer = getWss();
  if (!wsServer) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    socket.destroy();
    return;
  }

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

  // Token 1) Authorization header, 2) Sec-WebSocket-Protocol subprotocol dan olinadi
  let token = null;
  const authHeader = request.headers['authorization'] || request.headers['Authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  // Subprotocol orqali: "bearer.TOKEN_VALUE"
  if (!token) {
    const proto = request.headers['sec-websocket-protocol'] || '';
    const match = proto.match(/(?:^|,\s*)bearer\.(\S+)/);
    if (match) token = match[1];
  }

  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  let user;
  try {
    user = verifyAccessToken(token);
  } catch (_) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wsServer.handleUpgrade(request, socket, head, (ws) => {
    // tokenning exp vaqtini ham uzatamiz — sessiya muddatini nazorat qilish uchun
    addClient(user.user_id, ws, user.exp);
    ws.send(JSON.stringify({
      type: 'connected',
      data: { user_id: user.user_id },
    }));
    wsServer.emit('connection', ws, request);
  });
};

module.exports = router;
module.exports.handleUpgrade = handleUpgrade;
