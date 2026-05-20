const { WebSocketServer, WebSocket } = require('ws');

const clients = new Map();
let wss = null;

const initWebSocket = () => {
  wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'ping' && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (_) {}
    });

    ws.on('close', () => {
      if (ws._userId && clients.get(ws._userId) === ws) {
        clients.delete(ws._userId);
      }
    });

    ws.on('error', () => {});
  });

  return wss;
};

const getWss = () => wss;

const addClient = (userId, ws) => {
  const existing = clients.get(userId);
  if (existing && existing !== ws) {
    try { existing.terminate(); } catch (_) {}
  }
  ws._userId = userId;
  clients.set(userId, ws);
};

const removeClient = (userId) => {
  clients.delete(userId);
};

const sendToUser = (userId, event, data) => {
  const ws = clients.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: event, data }));
    } catch (_) {
      removeClient(userId);
    }
  }
};

const sendToBranchRole = (branchUsers, roles, event, data) => {
  branchUsers
    .filter(u => roles.includes(u.role))
    .forEach(u => sendToUser(u.id, event, data));
};

const sendToPreparers = (branchUsers, itemTypes, event, data) => {
  const { ROLE_PRODUCT_MAP } = require('../../utils/roles.utils');
  branchUsers.forEach(user => {
    const userTypes = new Set(user.extra_permissions || []);
    if (ROLE_PRODUCT_MAP[user.role]) userTypes.add(ROLE_PRODUCT_MAP[user.role]);
    if (itemTypes.some(t => userTypes.has(t))) {
      sendToUser(user.id, event, data);
    }
  });
};

const getClientCount = () => clients.size;

module.exports = {
  initWebSocket, getWss, addClient, removeClient,
  sendToUser, sendToBranchRole, sendToPreparers, getClientCount,
};
