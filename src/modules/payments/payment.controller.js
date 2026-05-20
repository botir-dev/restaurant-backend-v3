const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { success, error } = require('../../utils/response.utils');

// POST /payments/:orderId
const processPayment = async (req, res) => {
  const { orderId } = req.params;
  const { payment_type } = req.body;

  if (!payment_type || !['cash', 'card', 'qr_payment'].includes(payment_type)) {
    return error(res, 'To\'lov turi talab qilinadi (cash, card, qr_payment)');
  }

  try {
    const orderResult = await pool.query(
      `SELECT o.*, t.table_number,
        u_w.full_name as waiter_name,
        u_w.id as waiter_id
       FROM orders o
       JOIN tables t ON t.id = o.table_id
       LEFT JOIN users u_w ON u_w.id = o.waiter_id
       WHERE o.id = $1 AND o.branch_id = $2 AND o.status = 'payment_pending'`,
      [orderId, req.branchId]
    );
    if (orderResult.rows.length === 0) {
      return error(res, 'Buyurtma topilmadi yoki to\'lov uchun tayyor emas', 404);
    }

    const order = orderResult.rows[0];

    // Jami hisoblash
    const totalAmount = order.items.reduce(
      (sum, item) => sum + parseFloat(item.price) * item.quantity, 0
    );

    // Filial sozlamalarini olish (xizmat haqi % va ofitsiant %)
    const settingsResult = await pool.query(
      `SELECT service_fee_percent, waiter_commission_percent
       FROM branch_settings WHERE branch_id = $1`,
      [req.branchId]
    );
    const settings = settingsResult.rows[0] || { service_fee_percent: 0, waiter_commission_percent: 0 };
    const serviceFeePercent = parseFloat(settings.service_fee_percent) || 0;
    const waiterCommissionPercent = parseFloat(settings.waiter_commission_percent) || 0;

    const serviceFeeAmount = Math.round((totalAmount * serviceFeePercent) / 100);
    const grandTotal = totalAmount + serviceFeeAmount;
    const waiterEarned = Math.round((totalAmount * waiterCommissionPercent) / 100);

    // Buyurtmani paid qilish
    await pool.query(
      `UPDATE orders SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [orderId]
    );

    // Stol bo'shatish
    await pool.query(
      `UPDATE tables SET is_occupied = FALSE, current_order_id = NULL, updated_at = NOW()
       WHERE current_order_id = $1`,
      [orderId]
    );

    // Arxivga saqlash (service_fee ma'lumotlari bilan)
    await pool.query(
      `INSERT INTO order_archive (
        id, order_id, restaurant_id, branch_id, table_number,
        waiter_id, waiter_name, cashier_id, cashier_name,
        guest_count, items, total_amount, service_fee_percent,
        service_fee_amount, grand_total, payment_type, is_from_qr,
        service_started, service_ended
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())`,
      [
        uuidv4(), orderId, order.restaurant_id, order.branch_id,
        order.table_number, order.waiter_id, order.waiter_name,
        req.user.user_id, req.user.full_name || 'Kassir',
        order.guest_count, JSON.stringify(order.items),
        totalAmount, serviceFeePercent, serviceFeeAmount, grandTotal,
        payment_type, order.is_from_qr, order.created_at
      ]
    );

    // Ofitsiant kunlik maoshi hisoblash (agar waiter_id va komissiya > 0 bo'lsa)
    if (order.waiter_id && waiterCommissionPercent > 0) {
      const today = new Date().toISOString().split('T')[0];
      await pool.query(
        `INSERT INTO waiter_earnings (
           waiter_id, branch_id, date, total_orders,
           total_order_amount, commission_percent, earned_amount
         )
         VALUES ($1, $2, $3, 1, $4, $5, $6)
         ON CONFLICT (waiter_id, date) DO UPDATE SET
           total_orders = waiter_earnings.total_orders + 1,
           total_order_amount = waiter_earnings.total_order_amount + $4,
           commission_percent = $5,
           earned_amount = waiter_earnings.earned_amount + $6,
           updated_at = NOW()`,
        [order.waiter_id, req.branchId, today, totalAmount, waiterCommissionPercent, waiterEarned]
      );
    }

    return success(res, {
      order_id: orderId,
      total_amount: totalAmount,
      service_fee_percent: serviceFeePercent,
      service_fee_amount: serviceFeeAmount,
      grand_total: grandTotal,
      payment_type
    }, 'To\'lov qabul qilindi');

  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

// GET /payments/:orderId/check
const generateCheck = async (req, res) => {
  const { orderId } = req.params;
  try {
    const result = await pool.query(
      `SELECT a.*, b.name as branch_name, r.name as restaurant_name
       FROM order_archive a
       JOIN branches b ON b.id = a.branch_id
       JOIN restaurants r ON r.id = a.restaurant_id
       WHERE a.order_id = $1`,
      [orderId]
    );
    if (result.rows.length === 0) return error(res, 'Chek topilmadi', 404);

    const a = result.rows[0];
    const width = 42;
    const line = '='.repeat(width);
    const dLine = '-'.repeat(width);
    const center = (t) => ' '.repeat(Math.max(0, Math.floor((width - t.length) / 2))) + t;
    const row = (l, r) => {
      const rStr = String(r);
      const lStr = String(l).substring(0, width - rStr.length - 1);
      return lStr + ' '.repeat(width - lStr.length - rStr.length) + rStr;
    };
    const fmt = (n) => Number(n || 0).toLocaleString();

    const serviceStart = new Date(a.service_started).toLocaleString('uz-UZ');
    const serviceEnd = new Date(a.service_ended || Date.now()).toLocaleString('uz-UZ');
    const serviceFeePercent = parseFloat(a.service_fee_percent) || 0;
    const serviceFeeAmount = parseFloat(a.service_fee_amount) || 0;
    const grandTotal = parseFloat(a.grand_total) || parseFloat(a.total_amount) || 0;

    let text = '';
    text += line + '\n';
    text += center(a.restaurant_name) + '\n';
    text += center(a.branch_name) + '\n';
    text += line + '\n';
    text += row('Stol:', a.table_number) + '\n';
    text += row('Ofitsiant:', a.waiter_name || '-') + '\n';
    text += row('Kassir:', a.cashier_name || '-') + '\n';
    text += row('Mehmonlar:', a.guest_count) + '\n';
    text += row('Boshlanish:', serviceStart) + '\n';
    text += row('Tugash:', serviceEnd) + '\n';
    text += dLine + '\n';
    text += row('Mahsulot', 'Jami') + '\n';
    text += dLine + '\n';

    a.items.forEach(item => {
      text += row(`${item.name} x${item.quantity}`, fmt(parseFloat(item.price) * item.quantity) + ' so\'m') + '\n';
    });

    text += line + '\n';
    text += row('Mahsulotlar:', fmt(a.total_amount) + ' so\'m') + '\n';

    if (serviceFeePercent > 0) {
      text += row(`Xizmat haqi (${serviceFeePercent}%):`, fmt(serviceFeeAmount) + ' so\'m') + '\n';
    }

    text += row('JAMI:', fmt(grandTotal) + ' so\'m') + '\n';
    text += row('To\'lov turi:', a.payment_type === 'cash' ? 'Naqd' : a.payment_type === 'card' ? 'Karta' : 'QR') + '\n';
    text += line + '\n';
    text += center('Xaridingiz uchun rahmat!') + '\n';
    text += line + '\n';

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="check-${orderId}.txt"`);
    return res.send(text);
  } catch (err) {
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = { processPayment, generateCheck };
