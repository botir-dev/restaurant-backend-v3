const pool = require('../config/database');

const ROLE_PRODUCT_MAP = {
  cook:          'food',
  baker:         'bread',
  somsa_maker:   'somsa',
  grill_master:  'grill',
  turkish_cook:  'turkish',
  bartender:     'drink',
  icecream_maker:'icecream',
  tea_master:    'tea',
};

// PostgreSQL dan kelgan extra_permissions ni normalize qilish
// "{salad,food}" -> ["salad","food"]
// ["salad","food"] -> ["salad","food"]
const normalizePerms = (perms) => {
  if (Array.isArray(perms)) return perms;
  if (!perms) return [];
  if (typeof perms === 'string') {
    if (perms.startsWith('{') && perms.endsWith('}')) {
      const inner = perms.slice(1, -1);
      return inner ? inner.split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean) : [];
    }
    try { return JSON.parse(perms); } catch { return []; }
  }
  return [];
};

// Hodimning ruxsat etilgan product turlarini qaytaradi (async — DB dan custom rolni oladi)
const getAllowedTypes = async (role, extra_permissions, branchId = null) => {
  const perms = normalizePerms(extra_permissions);
  const types = new Set(perms);

  // Standart rol mapping
  if (ROLE_PRODUCT_MAP[role]) {
    types.add(ROLE_PRODUCT_MAP[role]);
  }

  // Custom rol — DBdan product_type_key ni olish
  const NON_PREPARER = ['manager', 'waiter', 'cashier', 'storekeeper', 'super_admin'];
  const isStandardPreparer = !!ROLE_PRODUCT_MAP[role];
  const isNonPreparer = NON_PREPARER.includes(role);

  if (!isStandardPreparer && !isNonPreparer && branchId) {
    try {
      const result = await pool.query(
        `SELECT product_type_key FROM custom_roles WHERE key = $1 AND branch_id = $2`,
        [role, branchId]
      );
      if (result.rows[0]?.product_type_key) {
        types.add(result.rows[0].product_type_key);
      }
    } catch (e) {
      // silent
    }
  }

  return Array.from(types);
};

// Sync versiya — SSE manager uchun (DB chaqirmasdan, faqat standart va extra_permissions)
const getAllowedTypesSync = (role, extra_permissions) => {
  const perms = normalizePerms(extra_permissions);
  const types = new Set(perms);
  if (ROLE_PRODUCT_MAP[role]) {
    types.add(ROLE_PRODUCT_MAP[role]);
  }
  return Array.from(types);
};

// Rol tayyorlovchimi?
const isPreparerRole = (role) => {
  const NON_PREPARER = ['manager', 'waiter', 'cashier', 'storekeeper', 'super_admin'];
  return !NON_PREPARER.includes(role);
};

module.exports = { ROLE_PRODUCT_MAP, getAllowedTypes, getAllowedTypesSync, isPreparerRole, normalizePerms };
