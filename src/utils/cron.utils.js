const pool = require('../config/database');

/**
 * Muddati o'tgan bronlarni avtomatik bekor qiladi
 * Har 5 daqiqada ishlaydi
 */
const cancelExpiredReservations = async () => {
  try {
    const result = await pool.query(
      `UPDATE reservations
       SET status = 'cancelled', cancel_reason = 'auto_cancel', updated_at = NOW()
       WHERE status = 'active'
         AND reserved_at + (duration_min || ' minutes')::interval < NOW()
       RETURNING id, table_id`
    );
    if (result.rows.length > 0) {
      console.log(`Cron: ${result.rows.length} ta bron avtomatik bekor qilindi`);
    }
  } catch (err) {
    console.error('Cron job xatosi:', err.message);
  }
};

const startCronJobs = () => {
  // Har 5 daqiqada
  setInterval(cancelExpiredReservations, 5 * 60 * 1000);
  console.log('Cron jobs ishga tushirildi');
};

module.exports = { startCronJobs, cancelExpiredReservations };
