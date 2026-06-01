const https = require('https');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8816564334:AAG86mUswxMDWbTj5Grd4MeoaW7liDqExho';

const sendTelegramMessage = (chatId, text) => {
  if (!chatId) {
    console.log('[Telegram] chatId yo'q, xabar yuborilmadi');
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      chat_id: String(chatId),
      text,
      parse_mode: 'HTML',
    });

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (!parsed.ok) {
            console.error('[Telegram] Xabar yuborishda xato:', parsed.description);
          } else {
            console.log('[Telegram] Xabar yuborildi, chat_id:', chatId);
          }
          resolve(parsed);
        } catch (e) {
          console.error('[Telegram] JSON parse xatosi:', data);
          resolve({});
        }
      });
    });

    req.on('error', (err) => {
      console.error('[Telegram] Request xatosi:', err.message);
      reject(err);
    });

    req.write(body);
    req.end();
  });
};

module.exports = { sendTelegramMessage };
