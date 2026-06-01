const pool = require('../config/database');
const { sendTelegramMessage } = require('./telegram');

const checkInventoryAlerts = async (branchId, itemIds = []) => {
  if (!itemIds.length) return;

  try {
    const result = await pool.query(
      `SELECT i.id, i.name, i.quantity, i.min_quantity, i.unit, i.custom_unit
       FROM inventory_items i
       WHERE i.branch_id = $1
         AND i.id = ANY($2)
         AND i.min_quantity > 0
         AND i.quantity <= i.min_quantity`,
      [branchId, itemIds]
    );

    console.log(`[InventoryAlert] Tekshirildi: ${itemIds.length} item, kam qolgan: ${result.rows.length}`);

    if (result.rows.length === 0) return;

    const settingsRes = await pool.query(
      `SELECT telegram_chat_id FROM branch_settings WHERE branch_id = $1`,
      [branchId]
    );

    const chatId = settingsRes.rows[0]?.telegram_chat_id;
    console.log(`[InventoryAlert] telegram_chat_id: ${chatId || 'YO\'Q'}`);

    if (!chatId) return;

    const branchRes = await pool.query(
      `SELECT b.name as branch_name, r.name as restaurant_name
       FROM branches b
       JOIN restaurants r ON r.id = b.restaurant_id
       WHERE b.id = $1`,
      [branchId]
    );
    const branchName = branchRes.rows[0]?.branch_name || '';
    const restaurantName = branchRes.rows[0]?.restaurant_name || '';

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
        `Omboni to\'ldirish kerak!`,
      ].join('\n');

      await sendTelegramMessage(chatId, message);
    }
  } catch (err) {
    console.error('[checkInventoryAlerts] Xato:', err.message);
  }
};

// Barcha branch inventory larni tekshirish (cron uchun)
const checkAllBranchInventory = async () => {
  try {
    const branches = await pool.query(
      `SELECT DISTINCT branch_id FROM branch_settings WHERE telegram_chat_id IS NOT NULL`
    );

    for (const row of branches.rows) {
      const items = await pool.query(
        `SELECT id FROM inventory_items
         WHERE branch_id = $1 AND min_quantity > 0 AND quantity <= min_quantity`,
        [row.branch_id]
      );
      if (items.rows.length > 0) {
        const ids = items.rows.map(r => r.id);
        await checkInventoryAlerts(row.branch_id, ids);
      }
    }
  } catch (err) {
    console.error('[checkAllBranchInventory] Xato:', err.message);
  }
};

module.exports = { checkInventoryAlerts, checkAllBranchInventory };
