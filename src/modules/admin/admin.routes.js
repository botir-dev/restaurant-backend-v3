const express = require('express');
const router = express.Router();
const { authenticate, superAdminOnly } = require('../../middleware/auth.middleware');
const c = require('./admin.controller');

router.use(authenticate, superAdminOnly);

// Restoranlar
router.get('/restaurants', c.getRestaurants);
router.post('/restaurants', c.createRestaurant);
router.put('/restaurants/:id', c.updateRestaurant);
router.delete('/restaurants/:id', c.deleteRestaurant);

// Filiallar
router.get('/branches', c.getBranches);
router.post('/branches', c.createBranch);
router.put('/branches/:id', c.updateBranch);

// Menejerlar
router.get('/managers', c.getManagers);
router.post('/managers', c.createManager);
router.put('/managers/:id', c.updateManager);
router.delete('/managers/:id', c.deleteManager);

module.exports = router;
