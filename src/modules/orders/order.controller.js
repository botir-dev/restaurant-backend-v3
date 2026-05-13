const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { success, created, error } = require('../../utils/response.utils');
const sseManager = require('../sse/sse.manager');

// Filial hodimlarini olish (SSE uchun)
const getBranchUsers = async (branchId) => {
  const result = await pool.query(
    `SELECT id, role, extra_permissions FROM users WHERE branch_id = $1 AND is_active = TRUE`,
    [branchId]
  );
  return result.rows;
};

// GET /orders?status=preparing
const getOrders = async (req, res) => {
  const { status } = req.query;
  const { role, extra_permissions, user_id } = req.user;
  const { isPreparerRole, getAllowedTypes } = require('../../utils/roles.utils');

  try {
    let where = `WHERE o.branch_id = $1 AND o.restaurant_id = $2`;
    const params = [req.branchId, req.restaurantId];
    let idx = 3;

    if (status) { where += ` AND o.status = $${idx++}`; params.push(status); }

    // Ofitsiant faqat o'z buyurtmalarini ko'radi
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

    // Tayyorlovchilar faqat o'z turlaridagi itemlarni ko'radi
    if (isPreparerRole(role)) {
      const allowedTypes = getAllowedTypes(role, extra_permissions);
      orders = orders
        .filter(o => ['preparing', 'ready_to_serve'].includes(o.status))
        .map(o => ({
          ...o,
          items: o.items.filter(item => allowedTypes.includes(item.type) && !item.is_prepared)
        }))
        .filter(o => o.items.length > 0);
    }

    return success(res, orders);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// POST /orders — Ofitsiant yoki QR emas, balki ofitsiant orqali
const createOrder = async (req, res) => {
  const { table_id, guest_count, items, waiter_id, is_from_qr } = req.body;
  if (!table_id || !items || !items.length) {
    return error(res, 'Stol va mahsulotlar talab qilinadi');
  }

  try {
    // Mahsulotlarni DBdan olish (narx va nom uchun)
    const productIds = items.map(i => i.product_id);
    const productsResult = await pool.query(
      `SELECT id, name, price, type, is_available FROM products
       WHERE id = ANY($1) AND branch_id = $2`,
      [productIds, req.branchId]
    );
    const productsMap = {};
    productsResult.rows.forEach(p => { productsMap[p.id] = p; });

    // Har bir itemni tekshirish va boyitish
    const enrichedItems = [];
    for (const item of items) {
      const product = productsMap[item.product_id];
      if (!product) return error(res, `Mahsulot topilmadi: ${item.product_id}`);
      if (!product.is_available) return error(res, `Mahsulot mavjud emas: ${product.name}`);
      enrichedItems.push({
        product_id: product.id,
        name: product.name,
        price: product.price,
        type: product.type,
        quantity: item.quantity || 1,
        is_prepared: false
      });
    }

    // QR buyurtma uchun waiter_id beriladi (mijoz tanlagan ofitsiant)
    const assignedWaiter = is_from_qr ? waiter_id : req.user.user_id;
    if (!assignedWaiter) return error(res, 'Ofitsiant ID talab qilinadi');

    const orderId = uuidv4();
    const result = await pool.query(
      `INSERT INTO orders (id, restaurant_id, branch_id, table_id, waiter_id, guest_count, items, is_from_qr)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [orderId, req.restaurantId || req.user.restaurant_id,
       req.branchId || req.user.branch_id,
       table_id, assignedWaiter, guest_count || 1,
       JSON.stringify(enrichedItems), is_from_qr || false]
    );

    const order = result.rows[0];

    // Stol band qilish
    await pool.query(
      `UPDATE tables SET is_occupied = TRUE, current_order_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [orderId, table_id]
    );

    // SSE: QR buyurtma kelganda ofitsiantga xabar
    if (is_from_qr) {
      sseManager.sendToUser(assignedWaiter, 'qr_order', {
        message: 'Mijoz QR orqali buyurtma berdi',
        order_id: orderId,
        table_id,
        items_count: enrichedItems.length
      });
    }

    return created(res, order, 'Buyurtma yaratildi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// PUT /orders/:id — itemlarni tahrirlash
const updateOrder = async (req, res) => {
  const { id } = req.params;
  const { items, guest_count } = req.body;

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
      // Mahsulotlarni boyitish
      const productIds = items.map(i => i.product_id);
      const productsResult = await pool.query(
        `SELECT id, name, price, type FROM products WHERE id = ANY($1) AND branch_id = $2`,
        [productIds, req.branchId]
      );
      const productsMap = {};
      productsResult.rows.forEach(p => { productsMap[p.id] = p; });

      const enrichedItems = items.map(item => {
        const product = productsMap[item.product_id];
        return {
          product_id: product.id,
          name: product.name,
          price: product.price,
          type: product.type,
          quantity: item.quantity || 1,
          is_prepared: item.is_prepared || false
        };
      });

      // Agar ready_to_serve va yangi item qo'shilsa — preparing ga qaytarish
      const hasNewUnprepared = enrichedItems.some(i => !i.is_prepared);
      if (order.status === 'ready_to_serve' && hasNewUnprepared) {
        newStatus = 'preparing';
      }

      await pool.query(
        `UPDATE orders SET items = $1, status = $2,
         guest_count = COALESCE($3, guest_count), updated_at = NOW()
         WHERE id = $4`,
        [JSON.stringify(enrichedItems), newStatus, guest_count, id]
      );

      // TZ: preparing yoki ready_to_serve holatida yangi (tayyor bo'lmagan) item
      // qo'shilsa, tayyorlovchilarga SSE yuboriladi
      const isActiveOrder = ['preparing', 'ready_to_serve'].includes(order.status);
      const newUnpreparedItems = enrichedItems.filter(i => !i.is_prepared);
      if (isActiveOrder && newUnpreparedItems.length > 0) {
        const branchUsers = await getBranchUsers(req.branchId);
        const newTypes = [...new Set(newUnpreparedItems.map(i => i.type))];
        sseManager.sendToPreparers(branchUsers, newTypes, 'new_order', {
          message: "Buyurtmaga yangi mahsulot qo'shildi",
          order_id: id,
          table_id: order.table_id,
          items: newUnpreparedItems
        });
      }

    } else if (guest_count) {
      await pool.query(
        `UPDATE orders SET guest_count = $1, updated_at = NOW() WHERE id = $2`,
        [guest_count, id]
      );
    }

    const updated = await pool.query(`SELECT * FROM orders WHERE id = $1`, [id]);
    return success(res, updated.rows[0], 'Buyurtma yangilandi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// PATCH /orders/:id/send — Tayyorlovchilarga yuborish
const sendToKitchen = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE orders SET status = 'preparing', sent_to_kitchen_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND branch_id = $2 AND status = 'pending'
       RETURNING *`,
      [id, req.branchId]
    );
    if (result.rows.length === 0) return error(res, 'Buyurtma topilmadi yoki yuborib bo\'lmaydi', 404);

    const order = result.rows[0];

    // SSE: tayyorlovchilarga xabar
    const branchUsers = await getBranchUsers(req.branchId);
    const itemTypes = [...new Set(order.items.map(i => i.type))];
    sseManager.sendToPreparers(branchUsers, itemTypes, 'new_order', {
      message: 'Yangi buyurtma keldi',
      order_id: order.id,
      table_id: order.table_id,
      items: order.items
    });

    return success(res, order, 'Buyurtma tayyorlovchilarga yuborildi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// PATCH /orders/:id/complete — payment_pending ga o'tkazish
// TZ 9.3: stol payment_pending da HALI bo'shalmaydi — kassir paid qilganda bo'shaydi
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

    // Stol bu yerda bo'shatilmaydi — kassir "Hisobni yopish" bosganda bo'shaydi

    return success(res, result.rows[0], 'Buyurtma yakunlandi, to\'lov kutilmoqda');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// PATCH /orders/:id/items/:itemId/prepare — Tayyorlovchi itemni belgilaydi
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
    const allowedTypes = getAllowedTypes(role, extra_permissions);

    const itemIndex = order.items.findIndex(i => i.product_id === itemId);
    if (itemIndex === -1) return error(res, 'Item topilmadi', 404);

    const item = order.items[itemIndex];
    if (!allowedTypes.includes(item.type)) {
      return error(res, 'Siz bu itemni tayyorlay olmaysiz', 403);
    }

    order.items[itemIndex].is_prepared = true;

    // Barcha itemlar tayyormi?
    const allPrepared = order.items.every(i => i.is_prepared);
    const newStatus = allPrepared ? 'ready_to_serve' : order.status;

    await pool.query(
      `UPDATE orders SET items = $1, status = $2, updated_at = NOW() WHERE id = $3`,
      [JSON.stringify(order.items), newStatus, id]
    );

    // SSE: barcha tayyor bo'lsa ofitsiantga xabar
    if (allPrepared) {
      sseManager.sendToUser(order.waiter_id, 'order_ready', {
        message: 'Buyurtma tayyor!',
        order_id: id,
        table_id: order.table_id
      });
    }

    return success(res, { order_id: id, all_prepared: allPrepared, status: newStatus }, 'Item tayyor deb belgilandi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// DELETE /orders/:id — Buyurtmani bekor qilish
const cancelOrder = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE orders SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND branch_id = $2 AND status NOT IN ('paid', 'payment_pending')
       RETURNING *`,
      [id, req.branchId]
    );
    if (result.rows.length === 0) return error(res, 'Buyurtma topilmadi yoki bekor qilib bo\'lmaydi', 400);

    await pool.query(
      `UPDATE tables SET is_occupied = FALSE, current_order_id = NULL
       WHERE current_order_id = $1`,
      [id]
    );

    return success(res, {}, 'Buyurtma bekor qilindi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = { getOrders, createOrder, updateOrder, sendToKitchen, completeOrder, prepareItem, cancelOrder };
