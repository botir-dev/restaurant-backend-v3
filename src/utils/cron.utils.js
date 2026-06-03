const pool = require('../config/database');
const { checkAllBranchInventory } = require('./inventory.alerts');
const { sendDailyReport } = require('./daily.report');

/**
 * Muddati o'tgan bronlarni avtomatik bekor qiladi.
 */
const cancelExpiredReservations = async (retryCount = 0) => {
  try {
    const result = await pool.query(
      `UPDATE reservations
       SET status = 'cancelled', cancel_reason = 'auto_cancel', updated_at = NOW()
       WHERE status = 'active'
         AND reserved_at + (duration_min || ' minutes')::interval < NOW()
       RETURNING id, table_id`
    );
    if (result.rows.length > 0) {
      console.log(`[Cron] ${result.rows.length} ta bron avtomatik bekor qilindi`);
    }
  } catch (err) {
    console.error(`[Cron] Bron bekor qilish xatosi (urinish: ${retryCount + 1}):`, err.message);
    if (retryCount < 2) {
      setTimeout(() => cancelExpiredReservations(retryCount + 1), 10_000);
    } else {
      console.error('[Cron] Qayta urinishlar muvaffaqiyatsiz — monitoring tekshirilsin!');
    }
  }
};

/**
 * Muddati o'tgan refresh tokenlarni tozalash (kuniga bir marta)
 */
const cleanExpiredRefreshTokens = async () => {
  try {
    const result = await pool.query(
      `DELETE FROM refresh_tokens WHERE expires_at < NOW() RETURNING id`
    );
    if (result.rows.length > 0) {
      console.log(`[Cron] ${result.rows.length} ta eskirgan refresh token o'chirildi`);
    }
  } catch (err) {
    console.error('[Cron] Refresh token tozalash xatosi:', err.message);
  }
};

const startCronJobs = () => {
  // Har 5 daqiqada bronlarni tekshirish
  setInterval(cancelExpiredReservations, 5 * 60 * 1000);

  // Har 24 soatda eskirgan tokenlarni tozalash
  setInterval(cleanExpiredRefreshTokens, 24 * 60 * 60 * 1000);

  // Har 6 soatda inventory ogohlantirishlarni tekshirish
  setInterval(checkAllBranchInventory, 6 * 60 * 60 * 1000);

  // ─── KUNLIK HISOBOT (Toshkent 23:59) ─────────────────────────
  // setInterval o'rniga — har 30 soniyada tekshirish + lastReportDate
  // Bu restart/deploy natijasida o'tkazib yuborishni oldini oladi:
  // agar server 23:58 da restart bo'lib 00:00 da ko'tarilsa,
  // u holda 23:xx soatida hisobot yuborilmagan bo'lsa — darhol yuboradi
  let lastReportDate = '';

  setInterval(() => {
    const now = new Date();
    // UTC+5 — Toshkent vaqti
    const tashkent = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const h = tashkent.getUTCHours();
    const m = tashkent.getUTCMinutes();
    const todayStr = tashkent.toISOString().split('T')[0]; // "2026-06-03"

    // 23:55 dan 23:59 gacha oraliqda — 1 daqiqa kutmasdan ishonchli tutib olish
    // Shart: bugun hali hisobot yuborilmagan bo'lsin
    if (h === 23 && m >= 55 && lastReportDate !== todayStr) {
      lastReportDate = todayStr;
      console.log(`[Cron] ${h}:${String(m).padStart(2,'0')} — kunlik hisobot yuborilmoqda... (${todayStr})`);
      sendDailyReport();
    }
  }, 30 * 1000); // har 30 soniyada tekshirish

  // Ishga tushganda bir marta darhol bajarish
  cancelExpiredReservations();
  cleanExpiredRefreshTokens();
  setTimeout(checkAllBranchInventory, 10_000);

  console.log('[Cron] Cron jobs ishga tushirildi');
};

module.exports = { startCronJobs, cancelExpiredReservations, cleanExpiredRefreshTokens };
