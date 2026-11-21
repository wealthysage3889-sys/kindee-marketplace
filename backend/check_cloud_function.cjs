const { Client } = require('pg');

const c = new Client({
  host: 'db.bzkjtvsqqxnbbnkgcrko.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Ngune038318',
  ssl: { rejectUnauthorized: false }
});

c.connect()
  .then(async () => {
    const r = await c.query(
      "SELECT pg_get_functiondef('check_and_reserve_stock'::regproc) AS def"
    );
    console.log('=== CLOUD FUNCTION DEFINITION ===');
    console.log(r.rows[0].def);
    await c.end();
  })
  .catch(e => {
    console.error('ERROR:', e.message);
    process.exit(1);
  });