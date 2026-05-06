import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const sql = postgres(url, { prepare: false });

console.log("=== All tables in public schema ===");
const tables = await sql`
  SELECT
    c.relname AS table,
    c.relrowsecurity AS rls_enabled,
    (SELECT COUNT(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename = c.relname) AS policy_count
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relkind = 'r'
  ORDER BY c.relname;
`;
for (const t of tables) {
  const flag = t.rls_enabled ? "✓ RLS" : "✗ NO RLS";
  console.log(`  ${flag.padEnd(10)} ${String(t.table).padEnd(30)} (${t.policy_count} policies)`);
}

console.log("\n=== Privileges granted to 'anon' role on public tables ===");
const anonGrants = await sql`
  SELECT table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
  FROM information_schema.role_table_grants
  WHERE grantee = 'anon'
    AND table_schema = 'public'
  GROUP BY table_name
  ORDER BY table_name;
`;
if (anonGrants.length === 0) console.log("  (none)");
for (const g of anonGrants) {
  console.log(`  ${String(g.table_name).padEnd(30)} ${g.privileges}`);
}

console.log("\n=== Privileges granted to 'authenticated' role on public tables ===");
const authGrants = await sql`
  SELECT table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
  FROM information_schema.role_table_grants
  WHERE grantee = 'authenticated'
    AND table_schema = 'public'
  GROUP BY table_name
  ORDER BY table_name;
`;
if (authGrants.length === 0) console.log("  (none)");
for (const g of authGrants) {
  console.log(`  ${String(g.table_name).padEnd(30)} ${g.privileges}`);
}

console.log("\n=== Functions in public schema (potential SECURITY DEFINER risks) ===");
const funcs = await sql`
  SELECT
    p.proname AS func,
    CASE p.prosecdef WHEN true THEN 'DEFINER' ELSE 'INVOKER' END AS security
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
  ORDER BY p.proname;
`;
if (funcs.length === 0) console.log("  (none)");
for (const f of funcs) {
  console.log(`  ${String(f.func).padEnd(40)} ${f.security}`);
}

console.log("\n=== Auth users (count + signup state) ===");
const userCount = await sql`SELECT COUNT(*)::int AS n FROM auth.users`;
console.log(`  ${userCount[0].n} users in auth.users`);

console.log("\n=== Connected as ===");
const who = await sql`SELECT current_user, current_database(), version()`;
console.log(`  user=${who[0].current_user} db=${who[0].current_database}`);
console.log(`  ${who[0].version.split(",")[0]}`);

await sql.end();
