const pool = require('../config/database');

// Standart rol -> product_type mapping
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

// Hodimning ko'ra oladigan product turlarini qaytaradi
// Custom rollar uchun DBdan product_type_key ni oladi
const getAllowedTypes = async (role, extra_permissions = [], branchId = null) => {
  const types = new Set(extra_permissions || []);

  // Standart rol
  if (ROLE_PRODUCT_MAP[role]) {
    types.add(ROLE_PRODUCT_MAP[role]);
  }

  // Custom rol — DBdan product_type_key ni olish
  if (!ROLE_PRODUCT_MAP[role] && role !== 'manager' && role !== 'waiter' &&
      role !== 'cashier' && role !== 'storekeeper' && role !== 'super_admin' && branchId) {
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

// Sync versiya (SSE manager uchun — DB chaqirmasdan)
const getAllowedTypesSync = (role, extra_permissions = []) => {
  const types = new Set(extra_permissions || []);
  if (ROLE_PRODUCT_MAP[role]) {
    types.add(ROLE_PRODUCT_MAP[role]);
  }
  return Array.from(types);
};

// Rol tayyorlovchimi?
const isPreparerRole = (role) => {
  const preparerRoles = Object.keys(ROLE_PRODUCT_MAP);
  return preparerRoles.includes(role) ||
    (!['manager', 'waiter', 'cashier', 'storekeeper', 'super_admin'].includes(role));
};

module.exports = { ROLE_PRODUCT_MAP, getAllowedTypes, getAllowedTypesSync, isPreparerRole };
