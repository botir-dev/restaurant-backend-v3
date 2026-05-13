// Har bir rol qaysi product_type uchun javobgar
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
const getAllowedTypes = (role, extra_permissions = []) => {
  const types = new Set(extra_permissions || []);
  if (ROLE_PRODUCT_MAP[role]) {
    types.add(ROLE_PRODUCT_MAP[role]);
  }
  return Array.from(types);
};

// Rol tayyorlovchimi?
const isPreparerRole = (role) => {
  return Object.keys(ROLE_PRODUCT_MAP).includes(role);
};

module.exports = { ROLE_PRODUCT_MAP, getAllowedTypes, isPreparerRole };
