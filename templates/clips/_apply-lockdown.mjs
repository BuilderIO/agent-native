import { readFile } from "node:fs/promises";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const sql = postgres(url, { prepare: false });

const sqlText = await readFile(
  "/Users/steve/Projects/builder/agent-native/framework/templates/macros/supabase/migrations/20260506_lock_down_public_schema.sql",
  "utf8",
);

console.log("Applying public schema lockdown...");
try {
  await sql.unsafe(sqlText);
  console.log("✓ Lockdown applied\n");
} catch (err) {
  console.error("✗ Failed:", err.message);
  await sql.end();
  process.exit(1);
}

console.log("=== Re-audit: tables in public schema ===");
const tables = await sql`
  SELECT
    c.relname AS table,
    c.relrowsecurity AS rls_enabled,
    (SELECT COUNT(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename = c.relname) AS policy_count
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
  ORDER BY c.relname;
`;
let rlsOff = 0;
for (const t of tables) {
  if (!t.rls_enabled) rlsOff++;
}
console.log(`  ${tables.length} tables total, ${tables.length - rlsOff} with RLS enabled, ${rlsOff} without`);

console.log("\n=== Re-audit: anon role grants on public ===");
const anonGrants = await sql`
  SELECT COUNT(*)::int AS n FROM information_schema.role_table_grants
  WHERE grantee = 'anon' AND table_schema = 'public';
`;
console.log(`  ${anonGrants[0].n} table-level grants remaining for anon (was 38×7=266 before)`);

console.log("\n=== Re-audit: authenticated role grants on public ===");
const authGrants = await sql`
  SELECT COUNT(*)::int AS n FROM information_schema.role_table_grants
  WHERE grantee = 'authenticated' AND table_schema = 'public';
`;
console.log(`  ${authGrants[0].n} table-level grants remaining for authenticated`);

console.log("\n=== Re-audit: default privileges for future tables ===");
const defaults = await sql`
  SELECT defaclobjtype, pg_get_userbyid(defaclrole) AS owner_role,
         array_to_string(defaclacl, '; ') AS acl
  FROM pg_default_acl da
  JOIN pg_namespace ns ON ns.oid = da.defaclnamespace
  WHERE ns.nspname = 'public'
  ORDER BY defaclobjtype;
`;
for (const d of defaults) {
  const t = { r: "tables", S: "sequences", f: "functions" }[d.defaclobjtype] ?? d.defaclobjtype;
  console.log(`  ${t.padEnd(11)} owner=${d.owner_role}  acl=${d.acl || "(no anon/authenticated grants)"}`);
}

console.log("\n=== Sanity: app's own tables can still be reached as postgres superuser ===");
const sample = await sql`SELECT COUNT(*)::int AS n FROM public.meals`;
console.log(`  SELECT COUNT(*) FROM public.meals → ${sample[0].n} rows ✓`);

await sql.end();
