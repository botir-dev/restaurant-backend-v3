const pool = require('../config/database');
const { sendTelegramMessage } = require('./telegram');

const fmt = (num) => {
  const n = parseFloat(num) || 0;
  return n.toLocaleString('uz-UZ') + " so'm";
};

const sign = (val) => {
  if (val > 0) return '+' + val.toLocaleString('uz-UZ');
  return val.toLocaleString('uz-UZ');
};

const pct = (today, yesterday) => {
  if (!yesterday || yesterday === 0) return today > 0 ? ' (yangi)' : '';
  const diff = ((today - yesterday) / yesterday * 100).toFixed(1);
  return diff > 0 ? ` (+${diff}%)` : ` (${diff}%)`;
};

const sendDailyReport = async () => {
  try {
    // Telegram chat_id si bor barcha branchlarni topish
    const branches = await pool.query(
      `SELECT bs.branch_id, bs.telegram_chat_id,
              b.name as branch_name, r.name as restaurant_name
       FROM branch_settings bs
       JOIN branches b ON b.id = bs.branch_id
       JOIN restaurants r ON r.id = b.restaurant_id
       WHERE bs.telegram_chat_id IS NOT NULL AND bs.telegram_chat_id != ''`
    );

    for (const branch of branches.rows) {
      try {
        await sendBranchDailyReport(branch);
      } catch (err) {
        console.error(`[DailyReport] Branch ${branch.branch_id} xatosi:`, err.message);
      }
    }
  } catch (err) {
    console.error('[DailyReport] Xato:', err.message);
  }
};

const sendBranchDailyReport = async (branch) => {
  const { branch_id, telegram_chat_id, branch_name, restaurant_name } = branch;

  // Bugungi statistika
  const today = await pool.query(
    `SELECT
       COUNT(*)::int                                                    as total_orders,
       COALESCE(SUM(guest_count), 0)::int                              as total_guests,
       COALESCE(SUM(total_amount + COALESCE(service_fee_amount,0)), 0) as revenue,
       COALESCE(SUM(COALESCE(vat_amount,0)), 0)                        as vat_collected,
       COALESCE(SUM(grand_total), 0)                                   as total_paid,
       COUNT(CASE WHEN order_type = 'table'    OR (is_from_qr = false AND (order_type IS NULL OR order_type = 'table')) THEN 1 END)::int as table_orders,
       COUNT(CASE WHEN is_from_qr = true                              THEN 1 END)::int as qr_orders,
       COUNT(CASE WHEN order_type = 'takeaway'                        THEN 1 END)::int as takeaway_orders,
       COUNT(CASE WHEN order_type = 'delivery'                        THEN 1 END)::int as delivery_orders,
       COALESCE(SUM(CASE WHEN order_type = 'table' OR (is_from_qr = false AND (order_type IS NULL OR order_type = 'table'))
                    THEN total_amount + COALESCE(service_fee_amount,0) ELSE 0 END), 0) as table_revenue,
       COALESCE(SUM(CASE WHEN is_from_qr = true
                    THEN total_amount + COALESCE(service_fee_amount,0) ELSE 0 END), 0) as qr_revenue,
       COALESCE(SUM(CASE WHEN order_type = 'takeaway'
                    THEN total_amount ELSE 0 END), 0)                  as takeaway_revenue,
       COALESCE(SUM(CASE WHEN order_type = 'delivery'
                    THEN total_amount ELSE 0 END), 0)                  as delivery_revenue
     FROM order_archive
     WHERE branch_id = $1 AND DATE(created_at) = CURRENT_DATE`,
    [branch_id]
  );

  // Kechagi statistika
  const yesterday = await pool.query(
    `SELECT
       COUNT(*)::int                                                    as total_orders,
       COALESCE(SUM(guest_count), 0)::int                              as total_guests,
       COALESCE(SUM(total_amount + COALESCE(service_fee_amount,0)), 0) as revenue
     FROM order_archive
     WHERE branch_id = $1 AND DATE(created_at) = CURRENT_DATE - INTERVAL '1 day'`,
    [branch_id]
  );

  const t = today.rows[0];
  const y = yesterday.rows[0];

  const orderDiff = t.total_orders - y.total_orders;
  const revDiff = parseFloat(t.revenue) - parseFloat(y.revenue);

  const title = `${restaurant_name}${branch_name ? ` — ${branch_name}` : ''}`;
  const dateStr = new Date().toLocaleDateString('uz-UZ', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tashkent'
  });

  const lines = [
    `📊 <b>Kunlik hisobot</b>`,
    `🏪 ${title}`,
    `📅 ${dateStr}`,
    ``,
    `👥 <b>Mijozlar:</b> ${t.total_guests} kishi`,
    `🛒 <b>Buyurtmalar:</b> ${t.total_orders} ta${pct(t.total_orders, y.total_orders)}`,
    `   ${orderDiff >= 0 ? '📈' : '📉'} Kechagidan: ${sign(orderDiff)} ta`,
    ``,
    `💰 <b>Daromad:</b> ${fmt(t.revenue)}${pct(parseFloat(t.revenue), parseFloat(y.revenue))}`,
    `   ${revDiff >= 0 ? '📈' : '📉'} Kechagidan: ${sign(Math.round(revDiff))} so'm`,
  ];

  if (parseFloat(t.vat_collected) > 0) {
    lines.push(`   🧾 QQS (davlatga): ${fmt(t.vat_collected)}`);
  }

  lines.push(`   💳 Mijoz to'lagan jami: ${fmt(t.total_paid)}`);
  lines.push(``);
  lines.push(`📋 <b>Buyurtma turlari:</b>`);

  if (t.table_orders > 0) {
    lines.push(`   🍽 An'anaviy (stol): ${t.table_orders} ta — ${fmt(t.table_revenue)}`);
  }
  if (t.qr_orders > 0) {
    lines.push(`   📱 QR kod: ${t.qr_orders} ta — ${fmt(t.qr_revenue)}`);
  }
  if (t.takeaway_orders > 0) {
    lines.push(`   🛍 Saboy: ${t.takeaway_orders} ta — ${fmt(t.takeaway_revenue)}`);
  }
  if (t.delivery_orders > 0) {
    lines.push(`   🚚 Dostavka: ${t.delivery_orders} ta — ${fmt(t.delivery_revenue)}`);
  }

  if (t.total_orders === 0) {
    lines.push(`   Bugun buyurtma qabul qilinmadi`);
  }

  lines.push(``);
  lines.push(`✅ Kun tugadi. Yaxshi dam oling!`);

  const message = lines.join('\n');
  await sendTelegramMessage(telegram_chat_id, message);
  console.log(`[DailyReport] ${title} uchun hisobot yuborildi`);
};

module.exports = { sendDailyReport };
