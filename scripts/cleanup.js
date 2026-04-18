require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const pool = mysql.createPool(process.env.DATABASE_URL);

  // 1) Remove exact timestamp duplicates — keep only the lowest id per (checked_at, natural95, diesel)
  const [r1] = await pool.execute(`
    DELETE p FROM price_checks p
    INNER JOIN (
      SELECT MIN(id) AS keep_id, checked_at, natural95, diesel
      FROM price_checks
      GROUP BY checked_at, natural95, diesel
      HAVING COUNT(*) > 1
    ) dups ON p.checked_at = dups.checked_at
           AND p.natural95 = dups.natural95
           AND p.diesel    = dups.diesel
           AND p.id != dups.keep_id
  `);
  console.log('Smazáno duplicit (stejný čas):', r1.affectedRows);

  // 2) Delete unchanged records that have a later record with the same prices.
  // Keeps: all changed=1 records + the single most recent unchanged tick.
  const [r2] = await pool.execute(`
    DELETE p FROM price_checks p
    WHERE p.changed = 0
      AND EXISTS (
        SELECT 1 FROM price_checks p2
        WHERE p2.checked_at > p.checked_at
          AND p2.natural95 = p.natural95
          AND p2.diesel    = p.diesel
      )
  `);
  console.log('Smazáno duplicit (stejná cena):', r2.affectedRows);
  await pool.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
