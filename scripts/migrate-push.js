// Creates the push_subscriptions table for Web Push notifications.
const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      endpoint VARCHAR(500) NOT NULL UNIQUE,
      p256dh VARCHAR(255) NOT NULL,
      auth VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('push_subscriptions table ready.');
  await conn.end();
})();
