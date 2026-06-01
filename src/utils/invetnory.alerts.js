const pool = require('../config/database');
const { sendTelegramMessage } = require('./telegram');

/**
 * Inventory itemlarni tekshirish — min_quantity ga yetgan bo'lsa telegram xabar yuborish
 * @param {string} branchId
 * @param {string[]} itemIds — tekshiriladigan item IDlar
 */
const checkInventoryAlerts = async (branchId, itemIds = []) => {
  if (!itemIds.length) return;

  try {
    // Min quantity ga yetgan yoki pastga tushgan itemlarni topish
    const result = await pool.query(
      `SELECT i.id, i.name, i.quantity, i.min_quantity,
              i.unit, i.custom_unit
       FROM inventory_items i
       WHERE i.branch_id = $1
         AND i.id = ANY($2)
         AND i.min_quantity > 0
         AND i.quantity <= i.min_quantity`,
      [branchId, itemIds]
    );

    if (result.rows.length === 0) return;

    // Branch ning telegram chat_id sini olish
    const settingsRes = await pool.query(
      `SELECT telegram_chat_id, restaurant_id FROM branch_settings WHERE branch_id = $1`,
      [branchId]
    );

    const chatId = settingsRes.rows[0]?.telegram_chat_id;
    if (!chatId) return;

    // Restoran va filial nomini olish
    const branchRes = await pool.query(
      `SELECT b.name as branch_name, r.name as restaurant_name
       FROM branches b
       JOIN restaurants r ON r.id = b.restaurant_id
       WHERE b.id = $1`,
      [branchId]
    );
    const branchName = branchRes.rows[0]?.branch_name || '';
    const restaurantName = branchRes.rows[0]?.restaurant_name || '';

    // Har bir kam qolgan mahsulot uchun xabar
    for (const item of result.rows) {
      const unit = item.unit === 'custom' ? (item.custom_unit || '?') : item.unit;
      const qty = parseFloat(item.quantity).toFixed(3).replace(/\.?0+$/, '');
      const minQty = parseFloat(item.min_quantity).toFixed(3).replace(/\.?0+$/, '');

      const message = [
        `⚠️ <b>Ombor ogohlantirishi</b>`,
        `🏪 ${restaurantName}${branchName ? ` — ${branchName}` : ''}`,
        ``,
        `📦 <b>${item.name}</b>`,
        `Qolgan: <b>${qty} ${unit}</b>`,
        `Minimal: ${minQty} ${unit}`,
        ``,
        `Omboni to'ldirish kerak!`,
      ].join('\n');

      await sendTelegramMessage(chatId, message).catch(() => {});
    }
  } catch (err) {
    console.error('[checkInventoryAlerts]', err.message);
  }
};

module.exports = { checkInventoryAlerts };
