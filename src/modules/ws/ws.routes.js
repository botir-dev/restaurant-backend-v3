const express = require('express');
const router = express.Router();
const { verifyAccessToken } = require('../../utils/jwt.utils');
const { addClient, getWss } = require('./ws.manager');

router.get('/status', (req, res) => {
  const { getClientCount } = require('./ws.manager');
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

  let token;
  try {
    token = new URL(request.url, `http://${request.headers.host}`).searchParams.get('token');
  } catch (_) {}

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
    addClient(user.user_id, ws);
    ws.send(JSON.stringify({
      type: 'connected',
      data: { user_id: user.user_id }
    }));
    wsServer.emit('connection', ws, request);
  });
};

module.exports = router;
module.exports.handleUpgrade = handleUpgrade;
