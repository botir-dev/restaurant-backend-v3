// ============================================================
// TARIF IMKONIYATLARI — har bir tarif nimaga ruxsat beradi
// ============================================================

/**
 * Har bir tarif uchun ochiq bo'lgan imkoniyatlar ro'yxati.
 * Frontend ham shu obyektni API orqali oladi va qulf/ochiq holatni ko'rsatadi.
 */
const TARIFF_FEATURES = {
  light: {
    // OCHIQ
    tables_management: true,       // Stollar boshqaruvi
    qr_ordering: true,             // QR-kod orqali buyurtma
    staff_management: true,        // Cheksiz xodimlar (waiter, cashier, cook...)
    kitchen_screen: true,          // Real-time oshxona ekrani
    cashier_panel: true,           // Kassir paneli va to'lovlar
    basic_daily_revenue: true,     // Faqat kunlik umumiy tushum
    orders: true,                  // Buyurtmalar moduli

    menu_management: true,         // Menyu boshqaruvi (tizim ishlashi uchun zarur)

    // YOPIQ
    inventory: false,              // Ombor boshqaruvi
    recipes: false,                // Retseptlar va avtomatik ayrilish
    inventory_alerts: false,       // Telegram ombor ogohlantirishlari
    advanced_reports: false,       // Kengaytirilgan hisobotlar
    pdf_reports: false,            // Hisobotlarni PDF yuklab olish
    staff_salary: false,           // Maosh va komissiya hisoblash
    multi_branch: false,           // Ko'p filial ko'rinishi
  },

  standard: {
    // OCHIQ (light + quyidagilar)
    tables_management: true,
    qr_ordering: true,
    staff_management: true,
    kitchen_screen: true,
    cashier_panel: true,
    basic_daily_revenue: true,
    orders: true,
    inventory: true,               // ✅ To'liq ombor boshqaruvi
    recipes: true,                 // ✅ Retseptlar va avtomatik ayrilish
    inventory_alerts: true,        // ✅ Telegram ombor ogohlantirishlari
    advanced_reports: true,        // ✅ Kengaytirilgan hisobotlar
    pdf_reports: true,             // ✅ PDF yuklab olish
    staff_salary: true,            // ✅ Maosh va komissiya
    menu_management: true,         // ✅ To'liq menyu boshqaruvi

    // YOPIQ
    multi_branch: false,           // Faqat 1 filial (premium kerak)
  },

  premium: {
    // HAMMASI OCHIQ
    tables_management: true,
    qr_ordering: true,
    staff_management: true,
    kitchen_screen: true,
    cashier_panel: true,
    basic_daily_revenue: true,
    orders: true,
    inventory: true,
    recipes: true,
    inventory_alerts: true,
    advanced_reports: true,
    pdf_reports: true,
    staff_salary: true,
    menu_management: true,
    multi_branch: true,            // ✅ Ko'p filial — faqat premium
  },

  // Tarif yo'q yoki not_available/expired holat
  none: {
    tables_management: false,
    qr_ordering: false,
    staff_management: false,
    kitchen_screen: false,
    cashier_panel: false,
    basic_daily_revenue: false,
    orders: false,
    inventory: false,
    recipes: false,
    inventory_alerts: false,
    advanced_reports: false,
    pdf_reports: false,
    staff_salary: false,
    menu_management: false,
    multi_branch: false,
  },
};

/**
 * Feature labels — frontend uchun chiroyli nomlar
 */
const FEATURE_LABELS = {
  tables_management: "Stollar boshqaruvi",
  qr_ordering: "QR-kod buyurtma",
  staff_management: "Xodimlar boshqaruvi",
  kitchen_screen: "Oshxona ekrani",
  cashier_panel: "Kassir paneli",
  basic_daily_revenue: "Kunlik tushum",
  orders: "Buyurtmalar",
  inventory: "Ombor boshqaruvi",
  recipes: "Retseptlar tizimi",
  inventory_alerts: "Ombor ogohlantirishlari",
  advanced_reports: "Kengaytirilgan hisobotlar",
  pdf_reports: "PDF hisobotlar",
  staff_salary: "Maosh va komissiya",
  menu_management: "Menyu boshqaruvi",
  multi_branch: "Ko'p filial (Premium)",
};

/**
 * Tarif aktiv holatlari
 */
const ACTIVE_STATUSES = ['active', 'grace_period'];

/**
 * Filial uchun aktiv tarif features ni qaytaradi
 * @param {string|null} tariffType - 'light' | 'standard' | 'premium' | null
 * @param {string|null} status - 'active' | 'grace_period' | 'expired' | 'not_available' | 'pending'
 * @returns {object} features
 */
const getFeatures = (tariffType, status) => {
  if (!tariffType || !ACTIVE_STATUSES.includes(status)) {
    return TARIFF_FEATURES.none;
  }
  return TARIFF_FEATURES[tariffType] || TARIFF_FEATURES.none;
};

/**
 * Bitta feature ruxsat berilganligini tekshiradi
 */
const hasFeature = (tariffType, status, featureKey) => {
  const features = getFeatures(tariffType, status);
  return features[featureKey] === true;
};

/**
 * Frontend uchun to'liq feature ro'yxatini qaytaradi (label, enabled, locked)
 */
const getFeaturesWithLabels = (tariffType, status) => {
  const features = getFeatures(tariffType, status);
  return Object.entries(FEATURE_LABELS).map(([key, label]) => ({
    key,
    label,
    enabled: features[key] === true,
    locked: features[key] !== true,
  }));
};

module.exports = {
  TARIFF_FEATURES,
  FEATURE_LABELS,
  ACTIVE_STATUSES,
  getFeatures,
  hasFeature,
  getFeaturesWithLabels,
};
