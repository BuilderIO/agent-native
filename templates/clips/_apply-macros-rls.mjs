import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const sql = postgres(url, { prepare: false });

const detail = await sql`
  SELECT tablename, policyname, cmd, roles, qual, with_check
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'weights'
  ORDER BY policyname;
`;
for (const p of detail) {
  console.log(`${p.policyname} (cmd=${p.cmd}, roles=${p.roles})`);
  console.log(`  USING: ${p.qual ?? "(none)"}`);
  console.log(`  WITH CHECK: ${p.with_check ?? "(none)"}`);
}
await sql.end();
