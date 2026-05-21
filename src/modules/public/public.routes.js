const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { success, error, paginate } = require('../../utils/response.utils');
const wsManager = require('../ws/ws.manager');

/**
 * GET /public/menu/:branch_id
 */
router.get('/menu/:branch_id', async (req, res) => {
  const { branch_id } = req.params;
  const { type, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

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
       LIMIT $${idx} OFFSET $${idx+1}`,
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

/**
 * GET /public/waiters/:branch_id
 */
router.get('/waiters/:branch_id', async (req, res) => {
  const { branch_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, full_name FROM users
       WHERE branch_id = $1 AND role = 'waiter' AND is_active = TRUE
       ORDER BY full_name`,
      [branch_id]
    );
    return success(res, result.rows, 'Ofitsiantlar ro\'yxati');
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
});

/**
 * POST /public/orders
 * QR orqali mijoz buyurtma beradi — darhol 'preparing' statusida yaratiladi
 * va oshxona xodimlariga WS xabar yuboriladi (ofitsiant kutmasdan)
 */
router.post('/orders', async (req, res) => {
  const { branch_id, table_id, waiter_id, items, guest_count } = req.body;

  if (!branch_id || !table_id || !waiter_id || !items || !items.length) {
    return error(res, 'branch_id, table_id, waiter_id va mahsulotlar talab qilinadi');
  }

  const { v4: uuidv4 } = require('uuid');
  const { ROLE_PRODUCT_MAP } = require('../../utils/roles.utils');

  try {
    // Waiter tekshirish
    const waiterCheck = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND branch_id = $2 AND role = 'waiter' AND is_active = TRUE`,
      [waiter_id, branch_id]
    );
    if (waiterCheck.rows.length === 0) return error(res, 'Ofitsiant topilmadi', 404);

    // Stol tekshirish
    const tableCheck = await pool.query(
      `SELECT id, restaurant_id FROM tables WHERE id = $1 AND branch_id = $2`,
      [table_id, branch_id]
    );
    if (tableCheck.rows.length === 0) return error(res, 'Stol topilmadi', 404);
    const restaurantId = tableCheck.rows[0].restaurant_id;

    // Mahsulotlarni boyitish
    const productIds = items.map(i => i.product_id);
    const productsResult = await pool.query(
      `SELECT id, name, price, type, is_available FROM products
       WHERE id = ANY($1) AND branch_id = $2 AND is_available = TRUE`,
      [productIds, branch_id]
    );
    const productsMap = {};
    productsResult.rows.forEach(p => { productsMap[p.id] = p; });

    const enrichedItems = [];
    for (const item of items) {
      const product = productsMap[item.product_id];
      if (!product) return error(res, `Mahsulot mavjud emas: ${item.product_id}`);
      enrichedItems.push({
        item_id: uuidv4(),
        product_id: product.id,
        name: product.name,
        price: product.price,
        type: product.type,
        quantity: item.quantity || 1,
        is_prepared: false
      });
    }

    const orderId = uuidv4();

    // ✅ 'preparing' — ofitsiant tasdiqlashini kutmasdan darhol oshxonaga
    await pool.query(
      `INSERT INTO orders (id, restaurant_id, branch_id, table_id, waiter_id, guest_count, items, is_from_qr, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,'preparing')`,
      [orderId, restaurantId, branch_id, table_id, waiter_id, guest_count || 1, JSON.stringify(enrichedItems)]
    );

    // Stol band qilish
    await pool.query(
      `UPDATE tables SET is_occupied = TRUE, current_order_id = $1, updated_at = NOW() WHERE id = $2`,
      [orderId, table_id]
    );

    // Filial barcha hodimlarini olish (WS xabar uchun)
    const branchUsers = await pool.query(
      `SELECT id, role, extra_permissions FROM users WHERE branch_id = $1 AND is_active = TRUE`,
      [branch_id]
    );
    const users = branchUsers.rows;

    // 1) Ofitsiantga xabar — mijoz buyurtma berdi
    wsManager.sendToUser(waiter_id, 'qr_order', {
      message: 'Mijoz QR orqali buyurtma berdi!',
      order_id: orderId,
      table_id,
      items_count: enrichedItems.length
    });

    // 2) Oshxona xodimlariga xabar — har biri o'z turi bo'yicha
    // item turlarini ajratib olish
    const itemTypes = [...new Set(enrichedItems.map(i => i.type))];

    wsManager.sendToPreparers(users, itemTypes, 'new_order', {
      message: `QR buyurtma: ${enrichedItems.length} ta mahsulot`,
      order_id: orderId,
      table_id,
      items: enrichedItems,
      items_count: enrichedItems.length
    });

    // 3) Menejerga ham xabar
    wsManager.sendToBranchRole(users, ['manager'], 'new_order', {
      message: `QR buyurtma keldi`,
      order_id: orderId,
      table_id,
      items_count: enrichedItems.length
    });

    return res.status(201).json({
      success: true,
      message: 'Buyurtmangiz qabul qilindi! Tayyorlanmoqda...',
      data: { order_id: orderId }
    });
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
});

module.exports = router;
