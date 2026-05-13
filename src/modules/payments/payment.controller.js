const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { success, error } = require('../../utils/response.utils');

// POST /payments/:orderId — To'lovni qabul qilish
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

    // Buyurtmani paid qilish
    await pool.query(
      `UPDATE orders SET status = 'paid', paid_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [orderId]
    );

    // TZ 9.3: stol faqat paid bo'lganda bo'shaydi (payment_pending da emas)
    await pool.query(
      `UPDATE tables SET is_occupied = FALSE, current_order_id = NULL, updated_at = NOW()
       WHERE current_order_id = $1`,
      [orderId]
    );

    // Arxivga saqlash
    await pool.query(
      `INSERT INTO order_archive (
        id, order_id, restaurant_id, branch_id, table_number,
        waiter_id, waiter_name, cashier_id, cashier_name,
        guest_count, items, total_amount, payment_type, is_from_qr,
        service_started, service_ended
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())`,
      [
        uuidv4(), orderId, order.restaurant_id, order.branch_id,
        order.table_number, order.waiter_id, order.waiter_name,
        req.user.user_id, req.user.full_name || 'Kassir',
        order.guest_count, JSON.stringify(order.items),
        totalAmount, payment_type, order.is_from_qr,
        order.created_at
      ]
    );

    return success(res, {
      order_id: orderId,
      total_amount: totalAmount,
      payment_type
    }, 'To\'lov qabul qilindi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// GET /payments/:orderId/check — Chek generatsiyasi (print format)
const generateCheck = async (req, res) => {
  const { orderId } = req.params;
  try {
    const result = await pool.query(
      `SELECT a.*, b.name as branch_name, r.name as restaurant_name, r.logo_url
       FROM order_archive a
       JOIN branches b ON b.id = a.branch_id
       JOIN restaurants r ON r.id = a.restaurant_id
       WHERE a.order_id = $1`,
      [orderId]
    );
    if (result.rows.length === 0) return error(res, 'Chek topilmadi', 404);

    const archive = result.rows[0];

    // Plain text chek (printer uchun)
    const width = 42;
    const line = '='.repeat(width);
    const dLine = '-'.repeat(width);

    const center = (text) => {
      const pad = Math.max(0, Math.floor((width - text.length) / 2));
      return ' '.repeat(pad) + text;
    };

    const row = (left, right) => {
      const rightStr = String(right);
      const leftStr = String(left).substring(0, width - rightStr.length - 1);
      return leftStr + ' '.repeat(width - leftStr.length - rightStr.length) + rightStr;
    };

    const serviceStart = new Date(archive.service_started).toLocaleString('uz-UZ');
    const serviceEnd = new Date(archive.service_ended || Date.now()).toLocaleString('uz-UZ');

    let text = '';
    text += line + '\n';
    text += center(archive.restaurant_name) + '\n';
    text += center(archive.branch_name) + '\n';
    text += line + '\n';
    text += row('Stol:', archive.table_number) + '\n';
    text += row('Ofitsiant:', archive.waiter_name || '-') + '\n';
    text += row('Kassir:', archive.cashier_name || '-') + '\n';
    text += row('Mehmonlar:', archive.guest_count) + '\n';
    text += row('Boshlanish:', serviceStart) + '\n';
    text += row('Tugash:', serviceEnd) + '\n';
    text += dLine + '\n';
    text += row('Mahsulot', 'Jami') + '\n';
    text += dLine + '\n';

    archive.items.forEach(item => {
      const itemTotal = (parseFloat(item.price) * item.quantity).toLocaleString();
      const label = `${item.name} x${item.quantity}`;
      text += row(label, itemTotal + ' so\'m') + '\n';
    });

    text += line + '\n';
    text += row('JAMI:', archive.total_amount.toLocaleString() + ' so\'m') + '\n';
    text += row('To\'lov turi:', archive.payment_type === 'cash' ? 'Naqd' :
                               archive.payment_type === 'card' ? 'Karta' : 'QR') + '\n';
    text += line + '\n';
    text += center('Xaridingiz uchun rahmat!') + '\n';
    text += line + '\n';

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="check-${orderId}.txt"`);
    return res.send(text);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = { processPayment, generateCheck };
