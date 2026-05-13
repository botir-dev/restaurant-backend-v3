require("dotenv").config();
const fs = require("fs");
const path = require("path");
const app = require("./src/app");
const pool = require("./src/config/database");
const { startCronJobs } = require("./src/utils/cron.utils");

const PORT = process.env.PORT || 3000;

const initDB = async () => {
  try {
    const check = await pool.query(
      `SELECT to_regclass('public.users') as exists`,
    );
    if (check.rows[0].exists) {
      console.log("DB sxemasi allaqachon mavjud, o'tkazib yuborildi");
      return;
    }
    const schema = fs.readFileSync(
      path.join(__dirname, "src/config/schema.sql"),
      "utf8",
    );
    await pool.query(schema);
    console.log("DB sxemasi muvaffaqiyatli yaratildi");
  } catch (err) {
    console.error("DB init xatosi:", err.message);
  }
};

app.listen(PORT, async () => {
  console.log(`Server ${PORT}-portda ishlamoqda`);
  await initDB();
  startCronJobs();
});
