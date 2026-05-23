const express = require('express');
const router  = express.Router();
const pool    = require('../../config/database');
const { success, error, paginate } = require('../../utils/response.utils');
const wsManager = require('../ws/ws.manager');

// Ruxsat etilgan mahsulot turlari (public endpointda ham ENUM tekshiruvi)
const VALID_PRODUCT_TYPES = [
  'food','drink','dessert','bread','somsa',
  'grill','turkish','bar','icecream','tea','other'
];

// ─── GET /public/menu/:branch_id ──────────────────────────────
router.get('/menu/:branch_id', async (req, res) => {
  const { branch_id } = req.params;
  const { type } = req.query;

  // Pagination DoS himoyasi
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  // ENUM tekshiruvi
  if (type && !VALID_PRODUCT_TYPES.includes(type)) {
    return error(res, "Noto'g'ri mahsulot turi");
  }

  try {
    let where = `WHERE p.branch_id = $1 AND p.is_available = TRUE`;
    const params = [branch_id];
    let idx = 2;

    if (type) { where += ` AND p.type = $${idx++}`; params.push(type); }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM products p ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT p.id, p.name, p.price, p.type, p.image_url
       FROM products p ${where}
       ORDER BY p.type, p.name
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    const grouped = {};
    result.rows.forEach(p => {
      if (!grouped[p.type]) grouped[p.type] = [];
      grouped[p.type].push(p);
    });

    return paginate(res, grouped, total, page, limit, 'Menyu');
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
});

// ─── GET /public/waiters/:branch_id ──────────────────────────
router.get('/waiters/:branch_id', async (req, res) => {
  const { branch_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, full_name FROM users
       WHERE branch_id = $1 AND role = 'waiter' AND is_active = TRUE
       ORDER BY full_name`,
      [branch_id]
    );
    return success(res, result.rows, "Ofitsiantlar ro'yxati");
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
});

// ─── POST /public/orders (QR buyurtma) ───────────────────────
router.post('/orders', async (req, res) => {
  const { branch_id, table_id, waiter_id, items, guest_count } = req.body;

  if (!branch_id || !table_id || !waiter_id || !Array.isArray(items) || items.length === 0) {
    return error(res, 'branch_id, table_id, waiter_id va mahsulotlar talab qilinadi');
  }

  // ─── Input validatsiyasi ───────────────────────────────────
  if (items.length > 50) return error(res, "Bir buyurtmada max 50 ta mahsulot bo'lishi mumkin");

  for (const item of items) {
    const qty = parseInt(item.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
      return error(res, "Har bir mahsulot miqdori 1 dan 999 gacha bo'lishi kerak");
    }
  }

  const guestCnt = parseInt(guest_count) || 1;
  if (guestCnt < 1 || guestCnt > 100) {
    return error(res, "Mehmonlar soni 1-100 orasida bo'lishi kerak");
  }

  const { v4: uuidv4 } = require('uuid');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ─── Waiter tekshirish ─────────────────────────────────
    const waiterCheck = await client.query(
      `SELECT id FROM users
       WHERE id = $1 AND branch_id = $2 AND role = 'waiter' AND is_active = TRUE`,
      [waiter_id, branch_id]
    );
    if (waiterCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return error(res, 'Ofitsiant topilmadi', 404);
    }

    // ─── Stol tekshirish + RACE CONDITION himoya (FOR UPDATE) ─
    const tableCheck = await client.query(
      `SELECT id, restaurant_id, is_occupied
       FROM tables WHERE id = $1 AND branch_id = $2
       FOR UPDATE`,
      [table_id, branch_id]
    );
    if (tableCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return error(res, 'Stol topilmadi', 404);
    }
    if (tableCheck.rows[0].is_occupied) {
      await client.query('ROLLBACK');
      return error(res, 'Stol hozir band. Iltimos, ofitsiantga murojaat qiling.');
    }

    const restaurantId = tableCheck.rows[0].restaurant_id;

    // ─── Mahsulotlarni tekshirish ──────────────────────────
    const productIds = items.map(i => i.product_id);
    const productsResult = await client.query(
      `SELECT id, name, price, type, is_available FROM products
       WHERE id = ANY($1) AND branch_id = $2`,
      [productIds, branch_id]
    );
    const productsMap = {};
    productsResult.rows.forEach(p => { productsMap[p.id] = p; });

    const enrichedItems = [];
    for (const item of items) {
      const product = productsMap[item.product_id];
      if (!product) {
        await client.query('ROLLBACK');
        return error(res, `Mahsulot topilmadi: ${item.product_id}`);
      }
      if (!product.is_available) {
        await client.query('ROLLBACK');
        return error(res, `Mahsulot mavjud emas: ${product.name}`);
      }
      enrichedItems.push({
        item_id:     uuidv4(),
        product_id:  product.id,
        name:        product.name,
        price:       parseFloat(product.price),
        type:        product.type,
        quantity:    parseInt(item.quantity) || 1,
        is_prepared: false,
      });
    }

    const orderId = uuidv4();

    await client.query(
      `INSERT INTO orders
         (id, restaurant_id, branch_id, table_id, waiter_id, guest_count, items, is_from_qr, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,'preparing')`,
      [orderId, restaurantId, branch_id, table_id,
       waiter_id, guestCnt, JSON.stringify(enrichedItems)]
    );

    await client.query(
      `UPDATE tables SET is_occupied = TRUE, current_order_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [orderId, table_id]
    );

    await client.query('COMMIT');

    // ─── WS xabarlari ─────────────────────────────────────
    const branchUsersResult = await pool.query(
      `SELECT id, role, extra_permissions FROM users
       WHERE branch_id = $1 AND is_active = TRUE`,
      [branch_id]
    );
    const branchUsers = branchUsersResult.rows;
    const itemTypes   = [...new Set(enrichedItems.map(i => i.type))];

    wsManager.sendToUser(waiter_id, 'qr_order', {
      message:     'Mijoz QR orqali buyurtma berdi!',
      order_id:    orderId,
      table_id,
      items_count: enrichedItems.length,
    });

    wsManager.sendToPreparers(branchUsers, itemTypes, 'new_order', {
      message:     `QR buyurtma: ${enrichedItems.length} ta mahsulot`,
      order_id:    orderId,
      table_id,
      items:       enrichedItems,
      items_count: enrichedItems.length,
    });

    wsManager.sendToBranchRole(branchUsers, ['manager'], 'new_order', {
      message:     'QR buyurtma keldi',
      order_id:    orderId,
      table_id,
      items_count: enrichedItems.length,
    });

    return res.status(201).json({
      success: true,
      message: 'Buyurtmangiz qabul qilindi! Tayyorlanmoqda...',
      data:    { order_id: orderId },
    });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return error(res, 'Server xatosi', 500);
  } finally {
    client.release();
  }
});

module.exports = router;
