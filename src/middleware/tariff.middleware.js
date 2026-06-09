const pool = require('../config/database');
const { error } = require('../utils/response.utils');
const { hasFeature, ACTIVE_STATUSES } = require('../utils/tariff.features');

/**
 * Fillial uchun aktiv tarif ma'lumotini oladi (cache yo'q — har doim DB dan)
 */
const getBranchTariff = async (branchId) => {
  if (!branchId) return null;
  try {
    const result = await pool.query(
      `SELECT tariff_type, status, expires_at, grace_ends_at
       FROM branch_tariffs WHERE branch_id = $1`,
      [branchId]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error('[TariffMiddleware] getBranchTariff xato:', err.message);
    return null;
  }
};

/**
 * Tarif holati aktiv ekanligini tekshiradi
 */
const isTariffActive = (tariff) => {
  if (!tariff) return false;
  return ACTIVE_STATUSES.includes(tariff.status);
};

/**
 * requireFeature(featureKey) — endpoint uchun feature tekshiradi
 *
 * Ishlatish:
 *   router.get('/inventory', authenticate, requireFeature('inventory'), inventoryController.getAll)
 */
const requireFeature = (featureKey) => {
  return async (req, res, next) => {
    // super_admin har doim o'tadi
    if (req.user?.role === 'super_admin') return next();

    const branchId = req.user?.branch_id || req.branchId;
    if (!branchId) return next(); // branch_id yo'q bo'lsa (owner global) — o'tkazib yuborish

    const tariff = await getBranchTariff(branchId);

    if (!isTariffActive(tariff)) {
      return error(res, 'Tarif faol emas. Bu funksiyadan foydalanish uchun tarifni yangilang.', 403);
    }

    if (!hasFeature(tariff.tariff_type, tariff.status, featureKey)) {
      return error(res,
        `Bu funksiya sizning "${tariff.tariff_type}" tarifingizda mavjud emas. Yuqori tarif kerak.`,
        403
      );
    }

    // Tarif ma'lumotini req ga qo'shib qo'yamiz (keyingi middleware lar uchun)
    req.tariff = tariff;
    next();
  };
};

/**
 * checkTariffActive — endpoint da tarif umuman faol bo'lishi shart bo'lganda
 * (feature spetsifik emas, shunchaki tizimga kirish uchun)
 */
const checkTariffActive = async (req, res, next) => {
  if (req.user?.role === 'super_admin') return next();
  if (req.user?.role === 'owner') return next(); // owner global access

  const branchId = req.user?.branch_id;
  if (!branchId) return next();

  const tariff = await getBranchTariff(branchId);

  if (!tariff) {
    return error(res, 'Filialga tarif belgilanmagan. Superadmin bilan bog\'laning.', 403);
  }

  if (!isTariffActive(tariff)) {
    return error(res,
      tariff.status === 'grace_period'
        ? 'Tarif muddati tugagan. 24 soat ichida yangilang!'
        : 'Tarif faol emas. Tizimdan foydalanish bloklangan.',
      403
    );
  }

  req.tariff = tariff;
  next();
};

module.exports = { requireFeature, checkTariffActive, getBranchTariff, isTariffActive };
