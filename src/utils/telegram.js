const https = require('https');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8816564334:AAG86mUswxMDWbTj5Grd4MeoaW7liDqExho';

/**
 * Telegram ga xabar yuborish
 * @param {string} chatId
 * @param {string} text
 */
const sendTelegramMessage = (chatId, text) => {
  if (!chatId) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      chat_id: chatId,
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
      res.on('end', () => resolve(JSON.parse(data)));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
};

module.exports = { sendTelegramMessage };
