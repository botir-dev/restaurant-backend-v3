const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { branchFilter } = require('../../middleware/branch.middleware');
const c = require('./staff-meal.controller');

// Manager va Cashier kirishi mumkin
router.use(authenticate, branchFilter, authorize('manager', 'cashier'));

// Hisobot faqat manager uchun
router.get('/report', authorize('manager'), c.getStaffMealReport);

router.get('/',      c.getStaffMeals);
router.post('/',     c.createStaffMeal);
router.delete('/:id', c.deleteStaffMeal);

module.exports = router;
