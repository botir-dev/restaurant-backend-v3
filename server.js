require('dotenv').config();
const app = require('./src/app');
const { startCronJobs } = require('./src/utils/cron.utils');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishlamoqda`);
  startCronJobs();
});
