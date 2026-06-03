const pool = require('../config/database');
const { checkAllBranchInventory } = require('./inventory.alerts');
const { sendDailyReport } = require('./daily.report');

/**
 * Muddati o'tgan bronlarni avtomatik bekor qiladi.
 * Xato bo'lsa qayta urinish mexanizmi bilan.
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
    // 3 marta qayta urinish — 10 soniyadan keyin
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

  // Har daqiqa soat 23:59 ni tekshirish (Toshkent vaqti)
  setInterval(() => {
    const now = new Date();
    // UTC+5 Toshkent vaqtiga o'tkazish
    const tashkent = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const h = tashkent.getUTCHours();
    const m = tashkent.getUTCMinutes();
    if (h === 10 && m === 24) {
      console.log('[Cron] 23:59 — kunlik hisobot yuborilmoqda...');
      sendDailyReport();
    }
  }, 60 * 1000);

  // Ishga tushganda bir marta darhol bajarish
  cancelExpiredReservations();
  cleanExpiredRefreshTokens();
  setTimeout(checkAllBranchInventory, 10_000);

  console.log('[Cron] Cron jobs ishga tushirildi');
};

module.exports = { startCronJobs, cancelExpiredReservations, cleanExpiredRefreshTokens };
