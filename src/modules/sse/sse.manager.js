/**
 * SSE (Server-Sent Events) menejeri
 * WebSocket o'rniga ishlatiladi — frontend tayyor bo'lganda WebSocketga o'tkaziladi
 * 
 * Har bir hodim ulanib, o'ziga tegishli xabarlarni oladi
 */

const clients = new Map(); // userId -> res

const addClient = (userId, res) => {
  // Avvalgi ulanishni uzish
  if (clients.has(userId)) {
    try { clients.get(userId).end(); } catch (_) {}
  }
  clients.set(userId, res);
  console.log(`SSE: Foydalanuvchi ulandi [${userId}]. Jami: ${clients.size}`);
};

const removeClient = (userId) => {
  clients.delete(userId);
  console.log(`SSE: Foydalanuvchi uzildi [${userId}]. Jami: ${clients.size}`);
};

/**
 * Bir foydalanuvchiga xabar yuborish
 */
const sendToUser = (userId, event, data) => {
  const client = clients.get(userId);
  if (client) {
    try {
      client.write(`event: ${event}\n`);
      client.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
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
  const { ROLE_PRODUCT_MAP } = require('../utils/roles.utils');

  branchUsers.forEach(user => {
    const userTypes = new Set(user.extra_permissions || []);
    if (ROLE_PRODUCT_MAP[user.role]) {
      userTypes.add(ROLE_PRODUCT_MAP[user.role]);
    }

    // Agar buyurtmadagi turlardan biri unga tegishli bo'lsa
    const hasMatch = itemTypes.some(t => userTypes.has(t));
    if (hasMatch) {
      sendToUser(user.id, event, data);
    }
  });
};

module.exports = {
  addClient,
  removeClient,
  sendToUser,
  sendToBranchRole,
  sendToPreparers
};
