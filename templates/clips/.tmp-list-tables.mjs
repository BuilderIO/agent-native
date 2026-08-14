import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });

try {
  const rows = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_name LIKE '%run%' OR table_name LIKE '%agent%' OR table_name LIKE '%event%'
    ORDER BY table_name
  `;
  console.log(JSON.stringify(rows, null, 2));
} catch (e) {
  console.error("ERR", e.message);
} finally {
  await sql.end({ timeout: 1 });
}
