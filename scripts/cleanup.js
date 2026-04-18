require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const pool = mysql.createPool(process.env.DATABASE_URL);

  // Delete unchanged records that have a later record with the same prices.
  // Keeps: all changed=1 records + the single most recent unchanged tick.
  const [result] = await pool.execute(`
    DELETE p FROM price_checks p
    WHERE p.changed = 0
      AND EXISTS (
        SELECT 1 FROM price_checks p2
        WHERE p2.checked_at > p.checked_at
          AND p2.natural95 = p.natural95
          AND p2.diesel    = p.diesel
      )
  `);

  console.log('Smazáno řádků:', result.affectedRows);
  await pool.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
