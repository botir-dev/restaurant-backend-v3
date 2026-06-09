const express = require('express');
const router  = express.Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const c = require('./owner.controller');

router.use(authenticate, authorize('owner'));

// Dashboard — barcha filiallar umumiy ko'rinishi
router.get('/dashboard', c.getDashboard);

// Filiallar solishtirish
router.get('/branches/compare', c.compareBranches);

// Barcha filiallar ombori solishtirish
router.get('/inventory/compare', c.compareInventory);

// Global hisobot (barcha filiallar yig'indisi)
router.get('/reports/global', c.getGlobalReport);

// Bitta filial — daromad grafigi
router.get('/branches/:branchId/revenue', c.getBranchRevenue);

// Bitta filial — ombor (faqat ko'rish)
router.get('/branches/:branchId/inventory', c.getBranchInventory);

// Bitta filial — harajat hisoboti
router.get('/branches/:branchId/reports/expenses', c.getBranchExpenses);

// Bitta filial — xodimlar (faqat ko'rish)
router.get('/branches/:branchId/staff', c.getBranchStaff);

// Bitta filial — staff meal hisoboti
router.get('/branches/:branchId/staff-meals', c.getBranchStaffMeals);

// Bitta filial — menyu (faqat ko'rish)
router.get('/branches/:branchId/menu', c.getBranchMenu);

// Bitta filial — arxiv (faqat ko'rish)
router.get('/branches/:branchId/archive', c.getBranchArchive);

// Filial nomi va manzilini o'zgartirish (FAQAT shu ikki maydon)
router.put('/branches/:branchId', c.updateBranch);

module.exports = router;
