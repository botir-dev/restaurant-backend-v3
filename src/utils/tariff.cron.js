const pool = require('../config/database');
const {
  notifyTariffExpiringSoon,
  notifyTariffGracePeriod,
  notifyTariffExpired,
} = require('./tariff.notify');

const GRACE_HOURS = 48; // Grace period davomiyligi (soat)

/**
 * 1. Muddati yaqinlashgan tariflarni tekshiradi (7 kun va 1 kun)
 * 2. Muddati tugagan tariflarni grace_period ga o'tkazadi
 * 3. Grace period tugagan tariflarni not_available ga o'tkazadi
 */
const checkTariffExpiry = async () => {
  console.log('[TariffCron] Tarif muddatlarini tekshirish boshlandi...');
  const now = new Date();

  try {
    // ──────────────────────────────────────────────────────────
    // 1. Grace period tugagan → not_available
    // ──────────────────────────────────────────────────────────
    const graceExpired = await pool.query(
      `UPDATE branch_tariffs
       SET status = 'not_available', updated_at = NOW()
       WHERE status = 'grace_period'
         AND grace_ends_at IS NOT NULL
         AND grace_ends_at < NOW()
       RETURNING branch_id, tariff_type`
    );
    for (const row of graceExpired.rows) {
      console.log(`[TariffCron] Branch ${row.branch_id} → not_available (grace tugadi)`);
      await pool.query(
        `INSERT INTO tariff_logs (id, target_type, target_id, action, old_status, new_status)
         VALUES (gen_random_uuid(), 'branch', $1, 'expire', 'grace_period', 'not_available')`,
        [row.branch_id]
      );
      notifyTariffExpired(row.branch_id, row.tariff_type).catch(console.error);
    }

    // ──────────────────────────────────────────────────────────
    // 2. Muddati tugagan active tariflar → grace_period
    // ──────────────────────────────────────────────────────────
    const expired = await pool.query(
      `UPDATE branch_tariffs
       SET status = 'grace_period',
           grace_ends_at = NOW() + INTERVAL '${GRACE_HOURS} hours',
           updated_at = NOW()
       WHERE status = 'active'
         AND expires_at IS NOT NULL
         AND expires_at < NOW()
       RETURNING branch_id, tariff_type, grace_ends_at`
    );
    for (const row of expired.rows) {
      console.log(`[TariffCron] Branch ${row.branch_id} → grace_period`);
      await pool.query(
        `INSERT INTO tariff_logs (id, target_type, target_id, action, old_status, new_status, new_expires_at)
         VALUES (gen_random_uuid(), 'branch', $1, 'grace_start', 'active', 'grace_period', $2)`,
        [row.branch_id, row.grace_ends_at]
      );
      notifyTariffGracePeriod(row.branch_id, row.tariff_type, row.grace_ends_at).catch(console.error);
    }

    // ──────────────────────────────────────────────────────────
    // 3. Restoran tariflari — grace period tugagan
    // ──────────────────────────────────────────────────────────
    const restaurantGraceExpired = await pool.query(
      `UPDATE restaurant_tariffs
       SET status = 'not_available', updated_at = NOW()
       WHERE status = 'grace_period'
         AND grace_ends_at IS NOT NULL
         AND grace_ends_at < NOW()
       RETURNING restaurant_id`
    );
    for (const row of restaurantGraceExpired.rows) {
      // Barcha filiallarni ham bloklaymiz
      const branches = await pool.query(
        `SELECT id FROM branches WHERE restaurant_id = $1`, [row.restaurant_id]
      );
      for (const b of branches.rows) {
        await pool.query(
          `UPDATE branch_tariffs SET status = 'not_available', updated_at = NOW()
           WHERE branch_id = $1 AND tariff_type = 'premium'`, [b.id]
        );
        notifyTariffExpired(b.id, 'premium').catch(console.error);
      }
    }

    // ──────────────────────────────────────────────────────────
    // 4. Restoran tariflari — muddati tugadi → grace_period
    // ──────────────────────────────────────────────────────────
    const restaurantExpired = await pool.query(
      `UPDATE restaurant_tariffs
       SET status = 'grace_period',
           grace_ends_at = NOW() + INTERVAL '${GRACE_HOURS} hours',
           updated_at = NOW()
       WHERE status = 'active'
         AND expires_at IS NOT NULL
         AND expires_at < NOW()
       RETURNING restaurant_id, grace_ends_at`
    );
    for (const row of restaurantExpired.rows) {
      const branches = await pool.query(
        `SELECT id FROM branches WHERE restaurant_id = $1`, [row.restaurant_id]
      );
      for (const b of branches.rows) {
        await pool.query(
          `UPDATE branch_tariffs
           SET status = 'grace_period', grace_ends_at = $1, updated_at = NOW()
           WHERE branch_id = $2 AND tariff_type = 'premium'`,
          [row.grace_ends_at, b.id]
        );
        notifyTariffGracePeriod(b.id, 'premium', row.grace_ends_at).catch(console.error);
      }
    }

    // ──────────────────────────────────────────────────────────
    // 5. 7 kun qolgan tariflar uchun ogohlantirish
    // ──────────────────────────────────────────────────────────
    const sevenDayWarning = await pool.query(
      `SELECT branch_id, tariff_type, expires_at
       FROM branch_tariffs
       WHERE status = 'active'
         AND expires_at IS NOT NULL
         AND expires_at > NOW()
         AND expires_at <= NOW() + INTERVAL '7 days'
         AND expires_at > NOW() + INTERVAL '6 days'`
      // > 6 kun: faqat birinchi marta (6-7 kun oralig'ida)
    );
    for (const row of sevenDayWarning.rows) {
      const daysLeft = Math.ceil((new Date(row.expires_at) - now) / (1000 * 60 * 60 * 24));
      notifyTariffExpiringSoon(row.branch_id, row.tariff_type, row.expires_at, daysLeft).catch(console.error);
    }

    // ──────────────────────────────────────────────────────────
    // 6. 1 kun (24 soat) qolgan tariflar uchun ogohlantirish
    // ──────────────────────────────────────────────────────────
    const oneDayWarning = await pool.query(
      `SELECT branch_id, tariff_type, expires_at
       FROM branch_tariffs
       WHERE status = 'active'
         AND expires_at IS NOT NULL
         AND expires_at > NOW()
         AND expires_at <= NOW() + INTERVAL '24 hours'
         AND expires_at > NOW() + INTERVAL '23 hours'`
    );
    for (const row of oneDayWarning.rows) {
      notifyTariffExpiringSoon(row.branch_id, row.tariff_type, row.expires_at, 1).catch(console.error);
    }

    if (graceExpired.rows.length + expired.rows.length > 0) {
      console.log(`[TariffCron] Natija: ${expired.rows.length} ta grace_period ga, ${graceExpired.rows.length} ta not_available ga o'tdi`);
    }
  } catch (err) {
    console.error('[TariffCron] checkTariffExpiry xato:', err.message);
  }
};

module.exports = { checkTariffExpiry };
