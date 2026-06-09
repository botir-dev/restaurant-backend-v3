const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { success, created, error } = require('../../utils/response.utils');
const { getFeaturesWithLabels, TARIFF_FEATURES } = require('../../utils/tariff.features');
const {
  notifyTariffAssigned,
  notifyTariffExtended,
} = require('../../utils/tariff.notify');

// ─── YORDAMCHI: tarif logi yozish ────────────────────────────
const writeTariffLog = async (client, {
  targetType, targetId, action,
  oldTariff, newTariff, oldStatus, newStatus,
  oldExpiresAt, newExpiresAt, performedBy, note
}) => {
  await client.query(
    `INSERT INTO tariff_logs
       (id, target_type, target_id, action,
        old_tariff, new_tariff, old_status, new_status,
        old_expires_at, new_expires_at, performed_by, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      uuidv4(), targetType, targetId, action,
      oldTariff || null, newTariff || null,
      oldStatus || null, newStatus || null,
      oldExpiresAt || null, newExpiresAt || null,
      performedBy, note || null
    ]
  );
};

// ─── YORDAMCHI: maxsus kalit tekshiruvi ──────────────────────
const verifySecretKey = async (secretKey) => {
  const result = await pool.query(`SELECT secret_key FROM tariff_config LIMIT 1`);
  if (result.rows.length === 0) {
    return { valid: false, reason: 'Tarif konfiguratsiyasi topilmadi. Avval superadmin sozlashni amalga oshiring.' };
  }
  if (result.rows[0].secret_key !== secretKey) {
    return { valid: false, reason: 'Maxsus kalit noto\'g\'ri!' };
  }
  return { valid: true };
};

// ============================================================
// KALIT SO'Z BOSHQARUVI
// ============================================================

// GET /admin/tariffs/config — joriy kalit bor-yo'qligini tekshirish (kalit o'zi emas)
const getTariffConfig = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, updated_at, updated_by FROM tariff_config LIMIT 1`
    );
    return success(res, {
      configured: result.rows.length > 0,
      updated_at: result.rows[0]?.updated_at || null,
    });
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// POST /admin/tariffs/config — kalit o'rnatish yoki yangilash
const setTariffConfig = async (req, res) => {
  const { new_secret_key, current_secret_key } = req.body;

  if (!new_secret_key || new_secret_key.length < 8) {
    return error(res, 'Yangi kalit kamida 8 belgidan iborat bo\'lishi kerak');
  }

  try {
    const existing = await pool.query(`SELECT id, secret_key FROM tariff_config LIMIT 1`);

    // Agar kalit allaqachon mavjud bo'lsa — eski kalitni talab qiladi
    if (existing.rows.length > 0) {
      if (!current_secret_key) {
        return error(res, 'Eski kalitni kiriting');
      }
      if (existing.rows[0].secret_key !== current_secret_key) {
        return error(res, 'Eski kalit noto\'g\'ri!');
      }
      await pool.query(
        `UPDATE tariff_config SET secret_key = $1, updated_at = NOW(), updated_by = $2`,
        [new_secret_key, req.user.user_id]
      );
    } else {
      // Birinchi marta o'rnatish
      await pool.query(
        `INSERT INTO tariff_config (id, secret_key, updated_by) VALUES ($1, $2, $3)`,
        [uuidv4(), new_secret_key, req.user.user_id]
      );
    }

    return success(res, {}, 'Tarif kaliti muvaffaqiyatli yangilandi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ============================================================
// FILIAL TARIFLARI
// ============================================================

// GET /admin/tariffs/branches — barcha filiallar tarifi
const getBranchTariffs = async (req, res) => {
  const { restaurant_id } = req.query;
  try {
    let query = `
      SELECT
        bt.id, bt.branch_id, bt.tariff_type, bt.status,
        bt.starts_at, bt.expires_at, bt.grace_ends_at, bt.note, bt.updated_at,
        b.name as branch_name, b.definition_name,
        r.id as restaurant_id, r.name as restaurant_name,
        u.full_name as assigned_by_name
      FROM branch_tariffs bt
      JOIN branches b ON b.id = bt.branch_id
      JOIN restaurants r ON r.id = b.restaurant_id
      LEFT JOIN users u ON u.id = bt.assigned_by
    `;
    const params = [];
    if (restaurant_id) {
      query += ` WHERE r.id = $1`;
      params.push(restaurant_id);
    }
    query += ` ORDER BY bt.updated_at DESC`;

    const result = await pool.query(query, params);
    return success(res, result.rows);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// GET /admin/tariffs/branches/:branchId — bitta filial tarifi
const getBranchTariff = async (req, res) => {
  const { branchId } = req.params;
  try {
    const result = await pool.query(
      `SELECT bt.*, b.name as branch_name, b.definition_name, r.name as restaurant_name
       FROM branch_tariffs bt
       JOIN branches b ON b.id = bt.branch_id
       JOIN restaurants r ON r.id = b.restaurant_id
       WHERE bt.branch_id = $1`,
      [branchId]
    );

    const tariff = result.rows[0] || null;
    const tariffType = tariff?.status && ['active','grace_period'].includes(tariff.status)
      ? tariff.tariff_type : 'none';

    return success(res, {
      tariff,
      features: getFeaturesWithLabels(tariffType, tariff?.status),
    });
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// POST /admin/tariffs/branches/:branchId/assign — tarif belgilash
const assignBranchTariff = async (req, res) => {
  const { branchId } = req.params;
  const { tariff_type, expires_at, secret_key, note } = req.body;

  if (!tariff_type || !secret_key) {
    return error(res, 'tariff_type va secret_key talab qilinadi');
  }
  if (!['light', 'standard'].includes(tariff_type)) {
    return error(res, 'Filialga faqat "light" yoki "standard" tarifi biriktirilishi mumkin');
  }

  // Kalit tekshiruvi
  const keyCheck = await verifySecretKey(secret_key);
  if (!keyCheck.valid) return error(res, keyCheck.reason, 403);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Mavjud tarifni olish (log uchun)
    const existing = await client.query(
      `SELECT * FROM branch_tariffs WHERE branch_id = $1`, [branchId]
    );
    const old = existing.rows[0];

    // UPSERT — mavjud bo'lsa yangilasin, bo'lmasa yaratsin
    const result = await client.query(
      `INSERT INTO branch_tariffs
         (id, branch_id, tariff_type, status, starts_at, expires_at, assigned_by, note)
       VALUES ($1, $2, $3, 'active', NOW(), $4, $5, $6)
       ON CONFLICT (branch_id) DO UPDATE SET
         tariff_type = EXCLUDED.tariff_type,
         status = 'active',
         starts_at = NOW(),
         expires_at = EXCLUDED.expires_at,
         grace_ends_at = NULL,
         assigned_by = EXCLUDED.assigned_by,
         note = EXCLUDED.note,
         updated_at = NOW()
       RETURNING *`,
      [uuidv4(), branchId, tariff_type, expires_at || null, req.user.user_id, note || null]
    );

    await writeTariffLog(client, {
      targetType: 'branch', targetId: branchId,
      action: old ? 'assign' : 'assign',
      oldTariff: old?.tariff_type, newTariff: tariff_type,
      oldStatus: old?.status, newStatus: 'active',
      oldExpiresAt: old?.expires_at, newExpiresAt: expires_at || null,
      performedBy: req.user.user_id, note,
    });

    await client.query('COMMIT');

    // Telegram ogohlantirish (async — await qilmaymiz, so'rov tezroq javob bersin)
    notifyTariffAssigned(branchId, tariff_type, expires_at || null).catch(console.error);

    return success(res, result.rows[0], 'Tarif muvaffaqiyatli belgilandi');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return error(res, 'Server xatosi', 500);
  } finally {
    client.release();
  }
};

// PUT /admin/tariffs/branches/:branchId/extend — tarif muddatini uzaytirish
const extendBranchTariff = async (req, res) => {
  const { branchId } = req.params;
  const { new_expires_at, secret_key, note } = req.body;

  if (!new_expires_at || !secret_key) {
    return error(res, 'new_expires_at va secret_key talab qilinadi');
  }

  const keyCheck = await verifySecretKey(secret_key);
  if (!keyCheck.valid) return error(res, keyCheck.reason, 403);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT * FROM branch_tariffs WHERE branch_id = $1`, [branchId]
    );
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return error(res, 'Filialda tarif topilmadi', 404);
    }
    const old = existing.rows[0];

    const result = await client.query(
      `UPDATE branch_tariffs SET
         expires_at = $1,
         grace_ends_at = NULL,
         status = CASE WHEN status = 'not_available' OR status = 'expired' THEN 'active' ELSE status END,
         note = COALESCE($2, note),
         updated_at = NOW()
       WHERE branch_id = $3
       RETURNING *`,
      [new_expires_at, note || null, branchId]
    );

    await writeTariffLog(client, {
      targetType: 'branch', targetId: branchId,
      action: 'extend',
      oldTariff: old.tariff_type, newTariff: old.tariff_type,
      oldStatus: old.status, newStatus: result.rows[0].status,
      oldExpiresAt: old.expires_at, newExpiresAt: new_expires_at,
      performedBy: req.user.user_id, note,
    });

    await client.query('COMMIT');

    notifyTariffExtended(branchId, old.tariff_type, new_expires_at).catch(console.error);

    return success(res, result.rows[0], 'Tarif muddati yangilandi');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return error(res, 'Server xatosi', 500);
  } finally {
    client.release();
  }
};

// DELETE /admin/tariffs/branches/:branchId/revoke — tarifni bekor qilish
const revokeBranchTariff = async (req, res) => {
  const { branchId } = req.params;
  const { secret_key, note } = req.body;

  if (!secret_key) return error(res, 'secret_key talab qilinadi');

  const keyCheck = await verifySecretKey(secret_key);
  if (!keyCheck.valid) return error(res, keyCheck.reason, 403);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT * FROM branch_tariffs WHERE branch_id = $1`, [branchId]
    );
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return error(res, 'Filialda tarif topilmadi', 404);
    }
    const old = existing.rows[0];

    await client.query(
      `UPDATE branch_tariffs SET status = 'not_available', updated_at = NOW() WHERE branch_id = $1`,
      [branchId]
    );

    await writeTariffLog(client, {
      targetType: 'branch', targetId: branchId,
      action: 'revoke',
      oldTariff: old.tariff_type, newTariff: old.tariff_type,
      oldStatus: old.status, newStatus: 'not_available',
      oldExpiresAt: old.expires_at, newExpiresAt: old.expires_at,
      performedBy: req.user.user_id, note,
    });

    await client.query('COMMIT');
    return success(res, {}, 'Tarif bekor qilindi');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return error(res, 'Server xatosi', 500);
  } finally {
    client.release();
  }
};

// ============================================================
// RESTORAN TARIFLARI (premium)
// ============================================================

// GET /admin/tariffs/restaurants/:restaurantId
const getRestaurantTariff = async (req, res) => {
  const { restaurantId } = req.params;
  try {
    const result = await pool.query(
      `SELECT rt.*, r.name as restaurant_name
       FROM restaurant_tariffs rt
       JOIN restaurants r ON r.id = rt.restaurant_id
       WHERE rt.restaurant_id = $1`,
      [restaurantId]
    );
    return success(res, result.rows[0] || null);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// POST /admin/tariffs/restaurants/:restaurantId/assign — premium tarif belgilash
const assignRestaurantTariff = async (req, res) => {
  const { restaurantId } = req.params;
  const { expires_at, secret_key, note } = req.body;

  if (!secret_key) return error(res, 'secret_key talab qilinadi');

  const keyCheck = await verifySecretKey(secret_key);
  if (!keyCheck.valid) return error(res, keyCheck.reason, 403);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT * FROM restaurant_tariffs WHERE restaurant_id = $1`, [restaurantId]
    );
    const old = existing.rows[0];

    // Restoranga premium tarif berish
    const result = await client.query(
      `INSERT INTO restaurant_tariffs
         (id, restaurant_id, tariff_type, status, starts_at, expires_at, assigned_by, note)
       VALUES ($1, $2, 'premium', 'active', NOW(), $3, $4, $5)
       ON CONFLICT (restaurant_id) DO UPDATE SET
         status = 'active',
         starts_at = NOW(),
         expires_at = EXCLUDED.expires_at,
         grace_ends_at = NULL,
         assigned_by = EXCLUDED.assigned_by,
         note = EXCLUDED.note,
         updated_at = NOW()
       RETURNING *`,
      [uuidv4(), restaurantId, expires_at || null, req.user.user_id, note || null]
    );

    await writeTariffLog(client, {
      targetType: 'restaurant', targetId: restaurantId,
      action: 'assign',
      oldTariff: old?.tariff_type, newTariff: 'premium',
      oldStatus: old?.status, newStatus: 'active',
      oldExpiresAt: old?.expires_at, newExpiresAt: expires_at || null,
      performedBy: req.user.user_id, note,
    });

    // Bu restoranning BARCHA filiallariga ham premium berish
    const branches = await client.query(
      `SELECT id FROM branches WHERE restaurant_id = $1 AND is_active = TRUE`, [restaurantId]
    );

    for (const branch of branches.rows) {
      const branchExisting = await client.query(
        `SELECT * FROM branch_tariffs WHERE branch_id = $1`, [branch.id]
      );
      const bOld = branchExisting.rows[0];

      await client.query(
        `INSERT INTO branch_tariffs
           (id, branch_id, tariff_type, status, starts_at, expires_at, assigned_by, note)
         VALUES ($1, $2, 'premium', 'active', NOW(), $3, $4, $5)
         ON CONFLICT (branch_id) DO UPDATE SET
           tariff_type = 'premium',
           status = 'active',
           starts_at = NOW(),
           expires_at = EXCLUDED.expires_at,
           grace_ends_at = NULL,
           assigned_by = EXCLUDED.assigned_by,
           note = EXCLUDED.note,
           updated_at = NOW()`,
        [uuidv4(), branch.id, expires_at || null, req.user.user_id, `Auto: restaurant premium (${restaurantId})`]
      );

      await writeTariffLog(client, {
        targetType: 'branch', targetId: branch.id,
        action: 'assign',
        oldTariff: bOld?.tariff_type, newTariff: 'premium',
        oldStatus: bOld?.status, newStatus: 'active',
        oldExpiresAt: bOld?.expires_at, newExpiresAt: expires_at || null,
        performedBy: req.user.user_id,
        note: `Restoran premium tarifi orqali avtomatik berildi`,
      });

      notifyTariffAssigned(branch.id, 'premium', expires_at || null).catch(console.error);
    }

    await client.query('COMMIT');
    return success(res, result.rows[0], `Premium tarif belgilandi. ${branches.rows.length} ta filial ham yangilandi.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return error(res, 'Server xatosi', 500);
  } finally {
    client.release();
  }
};

// PUT /admin/tariffs/restaurants/:restaurantId/extend
const extendRestaurantTariff = async (req, res) => {
  const { restaurantId } = req.params;
  const { new_expires_at, secret_key, note } = req.body;

  if (!new_expires_at || !secret_key) {
    return error(res, 'new_expires_at va secret_key talab qilinadi');
  }

  const keyCheck = await verifySecretKey(secret_key);
  if (!keyCheck.valid) return error(res, keyCheck.reason, 403);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT * FROM restaurant_tariffs WHERE restaurant_id = $1`, [restaurantId]
    );
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return error(res, 'Restoranda tarif topilmadi', 404);
    }
    const old = existing.rows[0];

    await client.query(
      `UPDATE restaurant_tariffs SET
         expires_at = $1, grace_ends_at = NULL,
         status = CASE WHEN status IN ('not_available','expired') THEN 'active' ELSE status END,
         updated_at = NOW()
       WHERE restaurant_id = $2`,
      [new_expires_at, restaurantId]
    );

    // Barcha filiallarni ham uzaytirish
    const branches = await client.query(
      `SELECT id FROM branches WHERE restaurant_id = $1`, [restaurantId]
    );
    for (const branch of branches.rows) {
      await client.query(
        `UPDATE branch_tariffs SET
           expires_at = $1, grace_ends_at = NULL,
           status = CASE WHEN status IN ('not_available','expired') THEN 'active' ELSE status END,
           updated_at = NOW()
         WHERE branch_id = $2 AND tariff_type = 'premium'`,
        [new_expires_at, branch.id]
      );
      notifyTariffExtended(branch.id, 'premium', new_expires_at).catch(console.error);
    }

    await writeTariffLog(client, {
      targetType: 'restaurant', targetId: restaurantId,
      action: 'extend',
      oldTariff: 'premium', newTariff: 'premium',
      oldStatus: old.status, newStatus: 'active',
      oldExpiresAt: old.expires_at, newExpiresAt: new_expires_at,
      performedBy: req.user.user_id, note,
    });

    await client.query('COMMIT');
    return success(res, {}, `Tarif muddati uzaytirildi. ${branches.rows.length} ta filial ham yangilandi.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return error(res, 'Server xatosi', 500);
  } finally {
    client.release();
  }
};

// ============================================================
// LOGLAR
// ============================================================

// GET /admin/tariffs/logs?target_id=&target_type=
const getTariffLogs = async (req, res) => {
  const { target_id, target_type, limit = 50 } = req.query;
  try {
    let query = `
      SELECT tl.*, u.full_name as performed_by_name
      FROM tariff_logs tl
      LEFT JOIN users u ON u.id = tl.performed_by
      WHERE 1=1
    `;
    const params = [];
    if (target_id) { query += ` AND tl.target_id = $${params.length+1}`; params.push(target_id); }
    if (target_type) { query += ` AND tl.target_type = $${params.length+1}`; params.push(target_type); }
    query += ` ORDER BY tl.created_at DESC LIMIT $${params.length+1}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);
    return success(res, result.rows);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ============================================================
// FILIAL O'Z TARIF MA'LUMOTINI OLADI
// ============================================================

// GET /tariffs/my — fillial menejeri o'z tarif holati va imkoniyatlarini ko'radi
const getMyTariff = async (req, res) => {
  const branchId = req.user?.branch_id;
  if (!branchId) return error(res, 'branch_id aniqlanmadi', 400);

  try {
    const result = await pool.query(
      `SELECT tariff_type, status, starts_at, expires_at, grace_ends_at
       FROM branch_tariffs WHERE branch_id = $1`,
      [branchId]
    );

    const tariff = result.rows[0] || null;
    const activeType = tariff && ['active','grace_period'].includes(tariff.status)
      ? tariff.tariff_type : null;

    return success(res, {
      tariff,
      features: getFeaturesWithLabels(activeType, tariff?.status),
      is_active: !!activeType,
    });
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = {
  getTariffConfig, setTariffConfig,
  getBranchTariffs, getBranchTariff, assignBranchTariff, extendBranchTariff, revokeBranchTariff,
  getRestaurantTariff, assignRestaurantTariff, extendRestaurantTariff,
  getTariffLogs,
  getMyTariff,
};
