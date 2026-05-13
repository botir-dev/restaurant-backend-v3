// JWT tokendan restaurant_id va branch_id ni olib, 
// so'rovga avtomatik qo'shadi. Frontend parametrlariga ishonilmaydi.

const branchFilter = (req, res, next) => {
  if (req.user && req.user.role !== 'super_admin') {
    req.restaurantId = req.user.restaurant_id;
    req.branchId = req.user.branch_id;
  }
  next();
};

module.exports = { branchFilter };
