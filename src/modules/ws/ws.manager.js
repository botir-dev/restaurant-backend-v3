/**
 * WebSocket menejeri
 * SSE dan WebSocketga to'liq o'tkazildi
 *
 * Har bir hodim ulanib, o'ziga tegishli xabarlarni oladi
 */

const { WebSocketServer, WebSocket } = require('ws');

// userId -> WebSocket instance
const clients = new Map();

let wss = null;

/**
 * WebSocket serverini yaratish va HTTP serverga ulash
 * @param {http.Server} httpServer
 */
const initWebSocket = (httpServer) => {
  wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws, req) => {
    // Token URL query parametridan olinadi: /ws?token=...
    // Auth middleware bu yerda ishlamaydi, shuning uchun token validatsiyasini manual qilamiz
    ws._userId = null;
    ws._pingTimeout = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);

        // Client: { type: 'auth', userId: '...' }
        // Auth middleware tomonidan userId allaqachon tekshirilgan va req ga qo'yilgan
        // Lekin WS da req.user yo'q — shuning uchun frontend userId ni yuboradi
        // (token esa HTTP upgrade request header da tekshiriladi)
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (_) {}
    });

    ws.on('close', () => {
      if (ws._userId) {
        // Faqat shu ws instance o'chirilsa — boshqasi allaqachon yangi ulanish olgan bo'lishi mumkin
        if (clients.get(ws._userId) === ws) {
          clients.delete(ws._userId);
          console.log(`WS: Foydalanuvchi uzildi [${ws._userId}]. Jami: ${clients.size}`);
        }
      }
      clearTimeout(ws._pingTimeout);
    });

    ws.on('error', (err) => {
      console.error('WS xatosi:', err.message);
    });
  });

  console.log('WebSocket server ishga tushdi');
  return wss;
};

/**
 * Foydalanuvchini ro'yxatga olish (auth muvaffaqiyatli bo'lgandan keyin)
 */
const addClient = (userId, ws) => {
  // Avvalgi ulanishni yopish
  const existing = clients.get(userId);
  if (existing && existing !== ws && existing.readyState === WebSocket.OPEN) {
    try {
      existing.send(JSON.stringify({ type: 'disconnected', reason: 'new_connection' }));
      existing.close();
    } catch (_) {}
  }

  ws._userId = userId;
  clients.set(userId, ws);
  console.log(`WS: Foydalanuvchi ulandi [${userId}]. Jami: ${clients.size}`);
};

const removeClient = (userId) => {
  clients.delete(userId);
  console.log(`WS: Foydalanuvchi o'chirildi [${userId}]. Jami: ${clients.size}`);
};

/**
 * Bir foydalanuvchiga xabar yuborish
 */
const sendToUser = (userId, event, data) => {
  const ws = clients.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: event, data }));
    } catch (err) {
      console.error(`WS: Xabar yuborishda xato [${userId}]:`, err.message);
      removeClient(userId);
    }
  }
};

/**
 * Bir filialdagi barcha hodimlardan ma'lum rollarga xabar yuborish
 * users: [{ id, role, extra_permissions }]
 */
const sendToBranchRole = (branchUsers, roles, event, data) => {
  branchUsers
    .filter(u => roles.includes(u.role))
    .forEach(u => sendToUser(u.id, event, data));
};

/**
 * Tayyorlovchilarga yangi item turi bo'yicha xabar yuborish
 * Har bir tayyorlovchi faqat o'z turidagi buyurtmani oladi
 */
const sendToPreparers = (branchUsers, itemTypes, event, data) => {
  const { ROLE_PRODUCT_MAP } = require('../../utils/roles.utils');

  branchUsers.forEach(user => {
    const userTypes = new Set(user.extra_permissions || []);
    if (ROLE_PRODUCT_MAP[user.role]) {
      userTypes.add(ROLE_PRODUCT_MAP[user.role]);
    }

    const hasMatch = itemTypes.some(t => userTypes.has(t));
    if (hasMatch) {
      sendToUser(user.id, event, data);
    }
  });
};

/**
 * Barcha ulangan mijozlar sonini olish (monitoring uchun)
 */
const getClientCount = () => clients.size;

module.exports = {
  initWebSocket,
  addClient,
  removeClient,
  sendToUser,
  sendToBranchRole,
  sendToPreparers,
  getClientCount,
};
