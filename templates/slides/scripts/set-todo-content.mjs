import { readFileSync } from 'fs';
import { config } from 'dotenv';
config();

const content = readFileSync('/tmp/todo-content.txt', 'utf8');
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1); }

console.log('Connecting to DB...');

// Use drizzle's underlying client approach - use pg module
const { default: pg } = await import('pg');
const { Pool } = pg;
const pool = new Pool({ connectionString: dbUrl });

try {
  const result = await pool.query(
    'UPDATE tools SET content = $1, updated_at = now() WHERE id = $2',
    [content, 'XSwk8NBeMKmcfqVRWIybi']
  );
  console.log('Updated! Rows affected:', result.rowCount);
} catch (err) {
  console.error('Error:', err.message);
} finally {
  await pool.end();
}
