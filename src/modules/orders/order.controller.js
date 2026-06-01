const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { success, created, error } = require('../../utils/response.utils');
const wsManager = require('../ws/ws.manager');
const { checkInventoryAlerts } = require('../../utils/inventory.alerts');

const getBranchUsers = async (branchId) => {
  const result = await pool.query(
    `SELECT id, role, extra_permissions FROM users WHERE branch_id = $1 AND is_active = TRUE`,
    [branchId]
  );
  return result.rows;
};

// ─── Yordamchi: quantity validatsiyasi ───────────────────────
const validateItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) return 'Mahsulotlar ro\'yxati bo\'sh';
  if (items.length > 50) return 'Bir buyurtmada max 50 ta mahsulot';
  for (const item of items) {
    const qty = parseInt(item.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
      return 'Har bir mahsulot miqdori 1 dan 999 gacha bo\'lishi kerak';
    }
  }
  return null;
};

const getOrders = async (req, res) => {
  const { status } = req.query;
  const { role, extra_permissions, user_id } = req.user;
  const { isPreparerRole, getAllowedTypes } = require('../../utils/roles.utils');

  try {
    let where = `WHERE o.branch_id = $1 AND o.restaurant_id = $2`;
    const params = [req.branchId, req.restaurantId];
    let idx = 3;

    // status whitelist
    const VALID_STATUSES = ['pending','preparing','ready_to_serve','payment_pending','paid','cancelled'];
    if (status && VALID_STATUSES.includes(status)) {
      where += ` AND o.status = $${idx++}`;
      params.push(status);
    }

    if (role === 'waiter') {
      where += ` AND o.waiter_id = $${idx++}`;
      params.push(user_id);
    }

    const result = await pool.query(
      `SELECT o.*, t.table_number FROM orders o
       JOIN tables t ON t.id = o.table_id
       ${where} ORDER BY o.created_at DESC`,
      params
    );

    let orders = result.rows;

    if (isPreparerRole(role)) {
      const allowedTypes = await getAllowedTypes(role, extra_permissions, req.branchId);
      orders = orders
        .filter(o => ['preparing', 'ready_to_serve'].includes(o.status))
        .map(o => ({
          ...o,
          items: o.items.filter(item => allowedTypes.includes(item.type) && !item.is_prepared),
        }))
        .filter(o => o.items.length > 0);
    }

    return success(res, orders);
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

const createOrder = async (req, res) => {
  const { table_id, guest_count, items, waiter_id, is_from_qr } = req.body;
  if (!table_id) return error(res, 'Stol ID talab qilinadi');

  const itemErr = validateItems(items);
  if (itemErr) return error(res, itemErr);

  const guestCnt = parseInt(guest_count) || 1;
  if (guestCnt < 1 || guestCnt > 100) return error(res, 'Mehmonlar soni 1-100 orasida bo\'lishi kerak');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ─── RACE CONDITION: stol qulflanadi ──────────────────────
    const tableResult = await client.query(
      `SELECT * FROM tables WHERE id = $1 AND branch_id = $2 FOR UPDATE`,
      [table_id, req.branchId]
    );
    if (tableResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return error(res, 'Stol topilmadi', 404);
    }
    // Stol band bo'lsa ham buyurtma qo'shish mumkin —
    // lekin faol buyurtmasi (current_order_id) bo'lsa bloklash
    if (tableResult.rows[0].is_occupied && tableResult.rows[0].current_order_id) {
      await client.query('ROLLBACK');
      return error(res, 'Stolda allaqachon faol buyurtma mavjud');
    }

    const productIds = items.map(i => i.product_id);
    const productsResult = await client.query(
      `SELECT id, name, price, type, is_available FROM menu_items
       WHERE id = ANY($1) AND branch_id = $2`,
      [productIds, req.branchId]
    );
    const productsMap = {};
    productsResult.rows.forEach(p => { productsMap[p.id] = p; });

    const enrichedItems = [];
    for (const item of items) {
      const product = productsMap[item.product_id];
      if (!product) { await client.query('ROLLBACK'); return error(res, `Mahsulot topilmadi: ${item.product_id}`); }
      if (!product.is_available) { await client.query('ROLLBACK'); return error(res, `Mahsulot mavjud emas: ${product.name}`); }
      enrichedItems.push({
        item_id:    uuidv4(),
        product_id: product.id,
        name:       product.name,
        price:      parseFloat(product.price),
        type:       product.type,
        quantity:   parseInt(item.quantity) || 1,
        is_prepared: false,
      });
    }

    const assignedWaiter = is_from_qr ? waiter_id : req.user.user_id;
    if (!assignedWaiter) { await client.query('ROLLBACK'); return error(res, 'Ofitsiant ID talab qilinadi'); }

    const orderId = uuidv4();
    const result = await client.query(
      `INSERT INTO orders (id, restaurant_id, branch_id, table_id, waiter_id, guest_count, items, is_from_qr)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [orderId, req.restaurantId || req.user.restaurant_id,
       req.branchId || req.user.branch_id,
       table_id, assignedWaiter, guestCnt,
       JSON.stringify(enrichedItems), is_from_qr || false]
    );

    await client.query(
      `UPDATE tables SET is_occupied = TRUE, current_order_id = $1, updated_at = NOW() WHERE id = $2`,
      [orderId, table_id]
    );

    // ─── OMBORDAN AVTOMATIK AYIRISH (retsept bo'yicha) ────────
    // Har bir buyurtma mahsuloti uchun menu_items retseptini tekshiramiz
    // (product_id = menu_items.id bo'lishi mumkin)
    const currentBranchId = req.branchId || req.user.branch_id;
    const affectedInventoryIds = [];
    for (const eItem of enrichedItems) {
      const recipeRes = await client.query(
        `SELECT r.inventory_item_id, r.quantity as recipe_qty,
                inv.quantity as stock_qty, inv.unit, inv.custom_unit, inv.name as inv_name
         FROM menu_item_recipes r
         JOIN inventory_items inv ON inv.id = r.inventory_item_id
         WHERE r.menu_item_id = $1 AND inv.branch_id = $2`,
        [eItem.product_id, currentBranchId]
      );

      if (recipeRes.rows.length === 0) continue; // retsept yo'q — o'tkazib yuborish

      for (const rLine of recipeRes.rows) {
        const needed      = parseFloat(rLine.recipe_qty) * eItem.quantity;
        const currentStock= parseFloat(rLine.stock_qty);
        const afterStock  = currentStock - needed;
        // Manfiy bo'lsa ham davom etamiz (ogohlantirish uchun log yoziladi)

        await client.query(
          `UPDATE inventory_items
           SET quantity = GREATEST(0, quantity - $1), updated_at = NOW()
           WHERE id = $2 AND branch_id = $3`,
          [needed, rLine.inventory_item_id, currentBranchId]
        );

        await client.query(
          `INSERT INTO inventory_logs
             (id, branch_id, inventory_item_id, change_amount, reason, order_id, before_quantity, after_quantity)
           VALUES ($1,$2,$3,$4,'order',$5,$6,$7)`,
          [
            uuidv4(), currentBranchId, rLine.inventory_item_id,
            -needed, orderId,
            currentStock, Math.max(0, afterStock)
          ]
        );
        if (!affectedInventoryIds.includes(rLine.inventory_item_id)) {
          affectedInventoryIds.push(rLine.inventory_item_id);
        }
      }
    }
    // ────────────────────────────────────────────────────────────

    await client.query('COMMIT');

    // Inventory alert tekshirish (fon rejimida)
    if (affectedInventoryIds.length > 0) {
      checkInventoryAlerts(currentBranchId, affectedInventoryIds).catch(() => {});
    }

    const order = result.rows[0];
    if (is_from_qr) {
      wsManager.sendToUser(assignedWaiter, 'qr_order', {
        message: 'Mijoz QR orqali buyurtma berdi',
        order_id: orderId, table_id, items_count: enrichedItems.length,
      });
    }

    return created(res, order, 'Buyurtma yaratildi');
  } catch (err) {
    await client.query('ROLLBACK');
    return error(res, 'Server xatosi', 500);
  } finally {
    client.release();
  }
};

const updateOrder = async (req, res) => {
  const { id } = req.params;
  const { items, guest_count } = req.body;

  if (items) {
    const itemErr = validateItems(items);
    if (itemErr) return error(res, itemErr);
  }
  if (guest_count !== undefined) {
    const gc = parseInt(guest_count);
    if (!Number.isInteger(gc) || gc < 1 || gc > 100) return error(res, 'Mehmonlar soni 1-100 orasida bo\'lishi kerak');
  }

  try {
    const orderResult = await pool.query(
      `SELECT * FROM orders WHERE id = $1 AND branch_id = $2`,
      [id, req.branchId]
    );
    if (orderResult.rows.length === 0) return error(res, 'Buyurtma topilmadi', 404);

    const order = orderResult.rows[0];
    if (['payment_pending', 'paid', 'cancelled'].includes(order.status)) {
      return error(res, 'Bu buyurtmani tahrirlash mumkin emas');
    }

    let newStatus = order.status;

    if (items) {
      const productIds = items.map(i => i.product_id);
      const productsResult = await pool.query(
        `SELECT id, name, price, type, is_available FROM menu_items WHERE id = ANY($1) AND branch_id = $2`,
        [productIds, req.branchId]
      );
      const productsMap = {};
      productsResult.rows.forEach(p => { productsMap[p.id] = p; });

      const enrichedItems = [];
      for (const item of items) {
        const product = productsMap[item.product_id];
        if (!product) return error(res, `Mahsulot topilmadi: ${item.product_id}`);
        // updateOrder da ham is_available tekshiruvi
        if (!product.is_available) return error(res, `Mahsulot mavjud emas: ${product.name}`);
        enrichedItems.push({
          item_id:     item.item_id || uuidv4(),
          product_id:  product.id,
          name:        product.name,
          price:       parseFloat(product.price),
          type:        product.type,
          quantity:    parseInt(item.quantity) || 1,
          is_prepared: item.is_prepared || false,
        });
      }

      const hasNewUnprepared = enrichedItems.some(i => !i.is_prepared);
      if (order.status === 'ready_to_serve' && hasNewUnprepared) newStatus = 'preparing';

      await pool.query(
        `UPDATE orders SET items = $1, status = $2,
         guest_count = COALESCE($3, guest_count), updated_at = NOW()
         WHERE id = $4`,
        [JSON.stringify(enrichedItems), newStatus, guest_count ? parseInt(guest_count) : null, id]
      );

      const isActiveOrder = ['preparing', 'ready_to_serve'].includes(order.status);
      const newUnpreparedItems = enrichedItems.filter(i => !i.is_prepared);
      if (isActiveOrder && newUnpreparedItems.length > 0) {
        const branchUsers = await getBranchUsers(req.branchId);
        const newTypes = [...new Set(newUnpreparedItems.map(i => i.type))];
        wsManager.sendToPreparers(branchUsers, newTypes, 'new_order', {
          message: "Buyurtmaga yangi mahsulot qo'shildi",
          order_id: id, table_id: order.table_id, items: newUnpreparedItems,
        });
      }
    } else if (guest_count) {
      await pool.query(
        `UPDATE orders SET guest_count = $1, updated_at = NOW() WHERE id = $2`,
        [parseInt(guest_count), id]
      );
    }

    const updated = await pool.query(`SELECT * FROM orders WHERE id = $1`, [id]);
    return success(res, updated.rows[0], 'Buyurtma yangilandi');
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

const sendToKitchen = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE orders SET status = 'preparing', sent_to_kitchen_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND branch_id = $2 AND status = 'pending'
       RETURNING *`,
      [id, req.branchId]
    );
    if (result.rows.length === 0) return error(res, "Buyurtma topilmadi yoki yuborib bo'lmaydi", 404);

    const order = result.rows[0];
    try {
      const branchUsers = await getBranchUsers(req.branchId);
      const itemsArr = Array.isArray(order.items) ? order.items : JSON.parse(order.items || '[]');
      const itemTypes = [...new Set(itemsArr.map(i => i.type).filter(Boolean))];
      wsManager.sendToPreparers(branchUsers, itemTypes, 'new_order', {
        message: 'Yangi buyurtma keldi',
        order_id: order.id, table_id: order.table_id, items: itemsArr,
      });
    } catch (_) {}

    return success(res, order, 'Buyurtma tayyorlovchilarga yuborildi');
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

const completeOrder = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE orders SET status = 'payment_pending', updated_at = NOW()
       WHERE id = $1 AND branch_id = $2 AND status = 'ready_to_serve'
       RETURNING *, (SELECT table_number FROM tables WHERE id = table_id) as table_number`,
      [id, req.branchId]
    );
    if (result.rows.length === 0) return error(res, 'Buyurtma hali tayyor emas', 400);

    // Kassirga real vaqtda xabar yuborish
    try {
      const branchUsers = await getBranchUsers(req.branchId);
      const order = result.rows[0];
      wsManager.sendToBranchRole(branchUsers, ['cashier', 'manager'], 'order_payment_pending', {
        message: `${order.table_number || 'Buyurtma'}-stol to'lovga tayyor!`,
        order_id: id,
        table_number: order.table_number,
      });
    } catch (_) {}

    return success(res, result.rows[0], "Buyurtma yakunlandi, to'lov kutilmoqda");
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

const prepareItem = async (req, res) => {
  const { id, itemId } = req.params;
  const { role, extra_permissions } = req.user;
  const { getAllowedTypes } = require('../../utils/roles.utils');

  try {
    const orderResult = await pool.query(
      `SELECT * FROM orders WHERE id = $1 AND branch_id = $2`,
      [id, req.branchId]
    );
    if (orderResult.rows.length === 0) return error(res, 'Buyurtma topilmadi', 404);

    const order = orderResult.rows[0];
    const allowedTypes = await getAllowedTypes(role, extra_permissions, req.branchId);
    const isManager = role === 'manager' || role === 'super_admin';

    let itemIndex = order.items.findIndex(i => i.item_id === itemId);
    if (itemIndex === -1) {
      itemIndex = order.items.findIndex(i => i.product_id === itemId && !i.is_prepared);
    }
    if (itemIndex === -1) return error(res, 'Item topilmadi yoki allaqachon tayyor', 404);

    const item = order.items[itemIndex];

    // Manager barcha itemlarni tayyorlay oladi, boshqalar faqat o'z turlarini
    if (!isManager && !allowedTypes.includes(item.type)) {
      return error(res, 'Siz bu itemni tayyorlay olmaysiz', 403);
    }

    order.items[itemIndex].is_prepared = true;
    const allPrepared = order.items.every(i => i.is_prepared);
    const newStatus = allPrepared ? 'ready_to_serve' : order.status;

    await pool.query(
      `UPDATE orders SET items = $1, status = $2, updated_at = NOW() WHERE id = $3`,
      [JSON.stringify(order.items), newStatus, id]
    );

    if (allPrepared) {
      const notifyUserId = ['takeaway','delivery'].includes(order.order_type)
        ? order.cashier_id || order.waiter_id
        : order.waiter_id;
      if (notifyUserId) {
        wsManager.sendToUser(notifyUserId, 'order_ready', {
          message: order.order_type === 'takeaway' ? 'Saboy tayyor!' :
                   order.order_type === 'delivery' ? 'Dostavka tayyor!' : 'Buyurtma tayyor!',
          order_id: id, table_id: order.table_id, order_type: order.order_type,
        });
      }
    }

    return success(res, { order_id: id, all_prepared: allPrepared, status: newStatus }, 'Item tayyor deb belgilandi');
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

const cancelOrder = async (req, res) => {
  const { id } = req.params;
  try {
    // payment_pending ham bloklanadi — kassirning vakolati
    const result = await pool.query(
      `UPDATE orders SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND branch_id = $2 AND status NOT IN ('paid', 'payment_pending', 'cancelled')
       RETURNING *`,
      [id, req.branchId]
    );
    if (result.rows.length === 0) return error(res, "Buyurtma topilmadi yoki bekor qilib bo'lmaydi", 400);

    await pool.query(
      `UPDATE tables SET is_occupied = FALSE, current_order_id = NULL
       WHERE current_order_id = $1`,
      [id]
    );

    return success(res, {}, 'Buyurtma bekor qilindi');
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

// ─── KASSIR BUYURTMASI (saboy/dostavka) ─────────────────────
// POST /orders/cashier
// Kassir to'g'ridan-to'g'ri buyurtma beradi, oshxonaga avtomatik ketadi
const createCashierOrder = async (req, res) => {
  const { items, order_type, guest_count, note } = req.body;

  if (!order_type || !['takeaway', 'delivery'].includes(order_type)) {
    return error(res, "order_type 'takeaway' yoki 'delivery' bo'lishi kerak");
  }

  const itemErr = validateItems(items);
  if (itemErr) return error(res, itemErr);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Mahsulotlarni tekshirish
    const productIds = items.map(i => i.product_id);
    const productsResult = await client.query(
      `SELECT id, name, price, type, is_available FROM menu_items
       WHERE id = ANY($1) AND branch_id = $2`,
      [productIds, req.branchId]
    );
    const productsMap = {};
    productsResult.rows.forEach(p => { productsMap[p.id] = p; });

    const enrichedItems = [];
    for (const item of items) {
      const product = productsMap[item.product_id];
      if (!product) { await client.query('ROLLBACK'); return error(res, `Mahsulot topilmadi: ${item.product_id}`); }
      if (!product.is_available) { await client.query('ROLLBACK'); return error(res, `Mahsulot mavjud emas: ${product.name}`); }
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

    // "Kassir stoli" — virtual stol (table_id = null bo'lmaydi, lekin
    // kassir buyurtmalari uchun maxsus virtual stol yaratamiz yoki mavjudini ishlatamiz)
    // Yechim: branch uchun "kassir" nomli virtual stol topish yoki yaratish
    let virtualTableResult = await client.query(
      `SELECT id FROM tables WHERE branch_id = $1 AND table_number = 0 LIMIT 1`,
      [req.branchId]
    );
    let virtualTableId;
    if (virtualTableResult.rows.length === 0) {
      const newTable = await client.query(
        `INSERT INTO tables (id, restaurant_id, branch_id, table_number, capacity, is_virtual)
         VALUES ($1, $2, $3, 0, 999, TRUE) RETURNING id`,
        [uuidv4(), req.user.restaurant_id, req.branchId]
      );
      virtualTableId = newTable.rows[0].id;
    } else {
      virtualTableId = virtualTableResult.rows[0].id;
    }

    const totalAmount = enrichedItems.reduce((s, i) => s + i.price * i.quantity, 0);
    const orderId = uuidv4();
    const guestCnt = parseInt(guest_count) || 1;

    // Buyurtma to'g'ridan-to'g'ri 'preparing' statusida yaratiladi
    const result = await client.query(
      `INSERT INTO orders (
         id, restaurant_id, branch_id, table_id, waiter_id,
         guest_count, items, is_from_qr, order_type, status, sent_to_kitchen_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, 'preparing', NOW())
       RETURNING *`,
      [
        orderId, req.user.restaurant_id, req.branchId,
        virtualTableId, req.user.user_id,
        guestCnt, JSON.stringify(enrichedItems), order_type
      ]
    );

    // Ombordan ayirish
    const cashierAffectedIds = [];
    for (const eItem of enrichedItems) {
      const recipeRes = await client.query(
        `SELECT r.inventory_item_id, r.quantity as recipe_qty, inv.quantity as stock_qty
         FROM menu_item_recipes r
         JOIN inventory_items inv ON inv.id = r.inventory_item_id
         WHERE r.menu_item_id = $1 AND inv.branch_id = $2`,
        [eItem.product_id, req.branchId]
      );
      for (const rLine of recipeRes.rows) {
        const needed = parseFloat(rLine.recipe_qty) * eItem.quantity;
        const currentStock = parseFloat(rLine.stock_qty);
        await client.query(
          `UPDATE inventory_items SET quantity = GREATEST(0, quantity - $1), updated_at = NOW()
           WHERE id = $2 AND branch_id = $3`,
          [needed, rLine.inventory_item_id, req.branchId]
        );
        await client.query(
          `INSERT INTO inventory_logs (id, branch_id, inventory_item_id, change_amount, reason, order_id, before_quantity, after_quantity)
           VALUES ($1,$2,$3,$4,'order',$5,$6,$7)`,
          [uuidv4(), req.branchId, rLine.inventory_item_id, -needed, orderId, currentStock, Math.max(0, currentStock - needed)]
        );
        if (!cashierAffectedIds.includes(rLine.inventory_item_id)) {
          cashierAffectedIds.push(rLine.inventory_item_id);
        }
      }
    }

    await client.query('COMMIT');

    // Inventory alert tekshirish (fon rejimida)
    if (cashierAffectedIds.length > 0) {
      checkInventoryAlerts(req.branchId, cashierAffectedIds).catch(() => {});
    }

    const order = result.rows[0];

    // WebSocket orqali oshxonaga yuborish
    try {
      const branchUsers = await getBranchUsers(req.branchId);
      const itemTypes = [...new Set(enrichedItems.map(i => i.type).filter(Boolean))];
      wsManager.sendToPreparers(branchUsers, itemTypes, 'new_order', {
        message: order_type === 'takeaway' ? 'Saboy buyurtma!' : 'Dostavka buyurtma!',
        order_id: orderId,
        table_id: virtualTableId,
        order_type,
        items: enrichedItems,
      });
    } catch (_) {}

    return created(res, order, 'Kassir buyurtmasi yaratildi');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return error(res, 'Server xatosi', 500);
  } finally {
    client.release();
  }
};

// ─── KASSIR BUYURTMALARINI OLISH ─────────────────────────────
// GET /orders/cashier — faqat kassir buyurtmalari (preparing/ready_to_serve/payment_pending)
const getCashierOrders = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, t.table_number FROM orders o
       JOIN tables t ON t.id = o.table_id
       WHERE o.branch_id = $1
         AND o.order_type IN ('takeaway', 'delivery')
         AND o.status IN ('preparing', 'ready_to_serve', 'payment_pending')
       ORDER BY o.created_at DESC`,
      [req.branchId]
    );
    return success(res, result.rows);
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = { getOrders, createOrder, updateOrder, sendToKitchen, completeOrder, prepareItem, cancelOrder, createCashierOrder, getCashierOrders };
