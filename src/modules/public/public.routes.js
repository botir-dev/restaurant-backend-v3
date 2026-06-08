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
    let where = `WHERE mi.branch_id = $1 AND mi.is_available = TRUE`;
    const params = [branch_id];
    let idx = 2;

    if (type) { where += ` AND mi.type = $${idx++}`; params.push(type); }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM menu_items mi ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT mi.id, mi.name, mi.price, mi.type, mi.image_url
       FROM menu_items mi ${where}
       ORDER BY mi.type, mi.name
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
const { checkInventoryAlerts } = require('../../utils/inventory.alerts');
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
      `SELECT id, name, price, type, is_available FROM menu_items
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

    const qrAffectedIds = [];
    // ─── OMBORDAN AVTOMATIK AYIRISH (retsept bo'yicha) ────────
    for (const eItem of enrichedItems) {
      const recipeRes = await client.query(
        `SELECT r.inventory_item_id, r.quantity as recipe_qty,
                inv.quantity as stock_qty
         FROM menu_item_recipes r
         JOIN inventory_items inv ON inv.id = r.inventory_item_id
         WHERE r.menu_item_id = $1 AND inv.branch_id = $2`,
        [eItem.product_id, branch_id]
      );

      if (recipeRes.rows.length === 0) continue; // retsept yo'q — o'tkazib yuborish

      for (const rLine of recipeRes.rows) {
        const needed      = parseFloat(rLine.recipe_qty) * eItem.quantity;
        const currentStock= parseFloat(rLine.stock_qty);
        const afterStock  = currentStock - needed;

        await client.query(
          `UPDATE inventory_items
           SET quantity = GREATEST(0, quantity - $1), updated_at = NOW()
           WHERE id = $2 AND branch_id = $3`,
          [needed, rLine.inventory_item_id, branch_id]
        );

        await client.query(
          `INSERT INTO inventory_logs
             (id, branch_id, inventory_item_id, change_amount, reason, order_id, before_quantity, after_quantity)
           VALUES ($1,$2,$3,$4,'order',$5,$6,$7)`,
          [
            uuidv4(), branch_id, rLine.inventory_item_id,
            -needed, orderId,
            currentStock, Math.max(0, afterStock)
          ]
        );
        if (!qrAffectedIds.includes(rLine.inventory_item_id)) {
          qrAffectedIds.push(rLine.inventory_item_id);
        }
      }
    }
    // ─────────────────────────────────────────────────────────

    await client.query('COMMIT');

    // Inventory alert tekshirish (fon rejimida)
    if (qrAffectedIds.length > 0) {
      checkInventoryAlerts(branch_id, qrAffectedIds).catch(() => {});
    }

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

// ─── GET /public/table-status/:branch_id/:table_id ───────────
// Stol band yoki aktiv buyurtma borligini tekshirish (auth shart emas)
router.get('/table-status/:branch_id/:table_id', async (req, res) => {
  const { branch_id, table_id } = req.params;
  try {
    const tableRes = await pool.query(
      `SELECT t.id, t.table_number, t.is_occupied, t.current_order_id,
              o.waiter_id, o.status as order_status,
              u.full_name as waiter_name
       FROM tables t
       LEFT JOIN orders o ON o.id = t.current_order_id
       LEFT JOIN users u ON u.id = o.waiter_id
       WHERE t.id = $1 AND t.branch_id = $2`,
      [table_id, branch_id]
    );
    if (tableRes.rows.length === 0) return error(res, 'Stol topilmadi', 404);

    const t = tableRes.rows[0];
    const hasActiveOrder = t.is_occupied && t.current_order_id && t.order_status === 'preparing';

    return success(res, {
      table_id:         t.id,
      table_number:     t.table_number,
      is_occupied:      t.is_occupied,
      has_active_order: hasActiveOrder,
      order_id:         hasActiveOrder ? t.current_order_id : null,
      waiter_id:        hasActiveOrder ? t.waiter_id : null,
      waiter_name:      hasActiveOrder ? t.waiter_name : null,
    });
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
});

// ─── POST /public/orders/add-items ───────────────────────────
// Mavjud buyurtmaga yangi mahsulotlar qo'shish (auth shart emas)
router.post('/orders/add-items', async (req, res) => {
  const { order_id, branch_id, items } = req.body;

  if (!order_id || !branch_id || !Array.isArray(items) || items.length === 0)
    return error(res, 'order_id, branch_id va mahsulotlar talab qilinadi');

  if (items.length > 50) return error(res, "Bir vaqtda max 50 ta mahsulot qo'shish mumkin");
  for (const item of items) {
    const qty = parseInt(item.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999)
      return error(res, "Har bir mahsulot miqdori 1-999 orasida bo'lishi kerak");
  }

  const { v4: uuidv4 } = require('uuid');
  const { checkInventoryAlerts } = require('../../utils/inventory.alerts');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Buyurtmani tekshirish va lock
    const orderRes = await client.query(
      `SELECT o.id, o.items, o.waiter_id, o.table_id, o.status
       FROM orders o
       WHERE o.id = $1 AND o.branch_id = $2 AND o.status = 'preparing'
       FOR UPDATE`,
      [order_id, branch_id]
    );
    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return error(res, "Aktiv buyurtma topilmadi yoki yopilgan", 404);
    }
    const order = orderRes.rows[0];
    const existingItems = Array.isArray(order.items) ? order.items : JSON.parse(order.items || '[]');

    // Mahsulotlarni tekshirish
    const productIds = items.map(i => i.product_id);
    const productsResult = await client.query(
      `SELECT id, name, price, type, is_available FROM menu_items
       WHERE id = ANY($1) AND branch_id = $2`,
      [productIds, branch_id]
    );
    const productsMap = {};
    productsResult.rows.forEach(p => { productsMap[p.id] = p; });

    const newItems = [];
    for (const item of items) {
      const product = productsMap[item.product_id];
      if (!product) { await client.query('ROLLBACK'); return error(res, `Mahsulot topilmadi: ${item.product_id}`); }
      if (!product.is_available) { await client.query('ROLLBACK'); return error(res, `Mavjud emas: ${product.name}`); }
      newItems.push({
        item_id:     uuidv4(),
        product_id:  product.id,
        name:        product.name,
        price:       parseFloat(product.price),
        type:        product.type,
        quantity:    parseInt(item.quantity) || 1,
        is_prepared: false,
      });
    }

    // Mavjud itemlarga qo'shish
    const mergedItems = [...existingItems, ...newItems];

    await client.query(
      `UPDATE orders SET items = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(mergedItems), order_id]
    );

    // Ombordan ayirish
    const affectedIds = [];
    for (const eItem of newItems) {
      const recipeRes = await client.query(
        `SELECT r.inventory_item_id, r.quantity as recipe_qty, inv.quantity as stock_qty
         FROM menu_item_recipes r
         JOIN inventory_items inv ON inv.id = r.inventory_item_id
         WHERE r.menu_item_id = $1 AND inv.branch_id = $2`,
        [eItem.product_id, branch_id]
      );
      for (const rLine of recipeRes.rows) {
        const needed = parseFloat(rLine.recipe_qty) * eItem.quantity;
        const before = parseFloat(rLine.stock_qty);
        await client.query(
          `UPDATE inventory_items SET quantity = GREATEST(0, quantity - $1), updated_at = NOW()
           WHERE id = $2 AND branch_id = $3`,
          [needed, rLine.inventory_item_id, branch_id]
        );
        await client.query(
          `INSERT INTO inventory_logs (id, branch_id, inventory_item_id, change_amount, reason, order_id, before_quantity, after_quantity)
           VALUES ($1,$2,$3,$4,'order',$5,$6,$7)`,
          [uuidv4(), branch_id, rLine.inventory_item_id, -needed, order_id, before, Math.max(0, before - needed)]
        );
        if (!affectedIds.includes(rLine.inventory_item_id)) affectedIds.push(rLine.inventory_item_id);
      }
    }

    await client.query('COMMIT');

    if (affectedIds.length > 0) checkInventoryAlerts(branch_id, affectedIds).catch(() => {});

    // WS — ofitsiant va oshxonaga xabar
    const branchUsersResult = await pool.query(
      `SELECT id, role, extra_permissions FROM users WHERE branch_id = $1 AND is_active = TRUE`,
      [branch_id]
    );
    const branchUsers = branchUsersResult.rows;
    const itemTypes = [...new Set(newItems.map(i => i.type))];

    wsManager.sendToUser(order.waiter_id, 'qr_order', {
      message:     'Mijoz QR orqali qo\'shimcha buyurtma berdi!',
      order_id,
      table_id:    order.table_id,
      items_count: newItems.length,
    });

    wsManager.sendToPreparers(branchUsers, itemTypes, 'new_order', {
      message:     `QR qo'shimcha buyurtma: ${newItems.length} ta mahsulot`,
      order_id,
      table_id:    order.table_id,
      items:       newItems,
      items_count: newItems.length,
    });

    return res.status(200).json({
      success: true,
      message: 'Buyurtmaga qo\'shildi! Tayyorlanmoqda...',
      data: { order_id, added_items: newItems.length },
    });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    return error(res, 'Server xatosi', 500);
  } finally {
    client.release();
  }
});

module.exports = router;
