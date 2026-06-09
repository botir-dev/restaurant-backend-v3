const { sendTelegramMessage } = require('./telegram');
const pool = require('../config/database');

/**
 * Fillial va uning restoraniga tegishli telegram chat_id larini oladi
 * (branch manager + restaurant owner)
 */
const getBranchNotifyTargets = async (branchId) => {
  try {
    const result = await pool.query(
      `SELECT
         b.name as branch_name,
         r.name as restaurant_name,
         -- Fillial menejeri
         u_mgr.telegram_chat_id as manager_chat_id,
         -- Restoran egasi
         u_own.telegram_chat_id as owner_chat_id
       FROM branches b
       JOIN restaurants r ON r.id = b.restaurant_id
       LEFT JOIN users u_mgr ON u_mgr.branch_id = b.id AND u_mgr.role = 'manager' AND u_mgr.is_active = TRUE
       LEFT JOIN users u_own ON u_own.restaurant_id = r.id AND u_own.role = 'owner' AND u_own.is_active = TRUE
       WHERE b.id = $1
       LIMIT 1`,
      [branchId]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error('[TariffNotify] getBranchNotifyTargets xato:', err.message);
    return null;
  }
};

/**
 * Bir nechta chat_id ga xabar yuboradi (dublikatlarni o'tkazib yuboradi)
 */
const sendToMultiple = async (chatIds, message) => {
  const unique = [...new Set(chatIds.filter(Boolean))];
  for (const chatId of unique) {
    try {
      await sendTelegramMessage(chatId, message);
    } catch (err) {
      console.error(`[TariffNotify] chatId=${chatId} ga yuborishda xato:`, err.message);
    }
  }
};

// ─── XABAR SHABLONLARI ────────────────────────────────────────

/**
 * Tarif belgilanganda xabar
 */
const notifyTariffAssigned = async (branchId, tariffType, expiresAt) => {
  const targets = await getBranchNotifyTargets(branchId);
  if (!targets) return;

  const expireStr = expiresAt
    ? `⏳ Muddat: <b>${new Date(expiresAt).toLocaleDateString('uz-UZ', { year: 'numeric', month: 'long', day: 'numeric' })}</b>`
    : '⏳ Muddat: <b>Muddatsiz</b>';

  const tariffNames = { light: 'Light 🔵', standard: 'Standard 🟢', premium: 'Premium ⭐' };

  const message = [
    `🎉 <b>Tarif belgilandi</b>`,
    `🏪 ${targets.restaurant_name} — ${targets.branch_name}`,
    ``,
    `📋 Tarif: <b>${tariffNames[tariffType] || tariffType}</b>`,
    expireStr,
    ``,
    `✅ Tizim to'liq ishga tushdi!`,
  ].join('\n');

  await sendToMultiple([targets.manager_chat_id, targets.owner_chat_id], message);
};

/**
 * Tarif muddati 7 kun qolganida ogohlantirish
 */
const notifyTariffExpiringSoon = async (branchId, tariffType, expiresAt, daysLeft) => {
  const targets = await getBranchNotifyTargets(branchId);
  if (!targets) return;

  const expireStr = new Date(expiresAt).toLocaleDateString('uz-UZ', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  const tariffNames = { light: 'Light 🔵', standard: 'Standard 🟢', premium: 'Premium ⭐' };
  const emoji = daysLeft <= 1 ? '🚨' : '⚠️';

  const message = [
    `${emoji} <b>Tarif muddati tugayapti!</b>`,
    `🏪 ${targets.restaurant_name} — ${targets.branch_name}`,
    ``,
    `📋 Tarif: <b>${tariffNames[tariffType] || tariffType}</b>`,
    `📅 Tugash sanasi: <b>${expireStr}</b>`,
    `⏰ Qolgan vaqt: <b>${daysLeft} kun</b>`,
    ``,
    `⚡ Iltimos, tarifni yangilang!`,
    `Aks holda tizim ${daysLeft <= 1 ? 'ertaga' : `${daysLeft} kundan so'ng`} bloklanadi.`,
  ].join('\n');

  await sendToMultiple([targets.manager_chat_id, targets.owner_chat_id], message);
};

/**
 * Grace period boshlanganda ogohlantirish (muddat tugadi, 24 soat bor)
 */
const notifyTariffGracePeriod = async (branchId, tariffType, graceEndsAt) => {
  const targets = await getBranchNotifyTargets(branchId);
  if (!targets) return;

  const graceStr = new Date(graceEndsAt).toLocaleString('uz-UZ');
  const tariffNames = { light: 'Light 🔵', standard: 'Standard 🟢', premium: 'Premium ⭐' };

  const message = [
    `🔴 <b>Tarif muddati tugadi — Grace Period</b>`,
    `🏪 ${targets.restaurant_name} — ${targets.branch_name}`,
    ``,
    `📋 Tarif: <b>${tariffNames[tariffType] || tariffType}</b>`,
    ``,
    `⚠️ Sizda <b>24 soat</b> vaqt qoldi tarifni yangilash uchun.`,
    `🕐 Bloklanish vaqti: <b>${graceStr}</b>`,
    ``,
    `❗ Yangilanmasa, tizim to'liq bloklanadi!`,
  ].join('\n');

  await sendToMultiple([targets.manager_chat_id, targets.owner_chat_id], message);
};

/**
 * Tarif to'liq bloklanganda xabar
 */
const notifyTariffExpired = async (branchId, tariffType) => {
  const targets = await getBranchNotifyTargets(branchId);
  if (!targets) return;

  const tariffNames = { light: 'Light 🔵', standard: 'Standard 🟢', premium: 'Premium ⭐' };

  const message = [
    `🚫 <b>Tarif bloklandi</b>`,
    `🏪 ${targets.restaurant_name} — ${targets.branch_name}`,
    ``,
    `📋 Tarif: <b>${tariffNames[tariffType] || tariffType}</b>`,
    ``,
    `❌ Tizimdan foydalanish to'xtatildi.`,
    `Qayta faollashtirish uchun superadmin bilan bog'laning.`,
  ].join('\n');

  await sendToMultiple([targets.manager_chat_id, targets.owner_chat_id], message);
};

/**
 * Tarif muddati uzaytirilganda xabar
 */
const notifyTariffExtended = async (branchId, tariffType, newExpiresAt) => {
  const targets = await getBranchNotifyTargets(branchId);
  if (!targets) return;

  const expireStr = newExpiresAt
    ? new Date(newExpiresAt).toLocaleDateString('uz-UZ', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Muddatsiz';
  const tariffNames = { light: 'Light 🔵', standard: 'Standard 🟢', premium: 'Premium ⭐' };

  const message = [
    `✅ <b>Tarif muddati uzaytirildi</b>`,
    `🏪 ${targets.restaurant_name} — ${targets.branch_name}`,
    ``,
    `📋 Tarif: <b>${tariffNames[tariffType] || tariffType}</b>`,
    `📅 Yangi muddat: <b>${expireStr}</b>`,
    ``,
    `🎉 Davom eting!`,
  ].join('\n');

  await sendToMultiple([targets.manager_chat_id, targets.owner_chat_id], message);
};

module.exports = {
  notifyTariffAssigned,
  notifyTariffExpiringSoon,
  notifyTariffGracePeriod,
  notifyTariffExpired,
  notifyTariffExtended,
};
