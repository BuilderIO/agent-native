import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
const turnId = "turn-acab5ab7-c953-4b77-af48-1d0148f42bee";
const threadId = "427718f0-3ea5-4b43-8551-edcf1108ee59";

try {
  const cols = await sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'agent_tool_ledger'
  `;
  console.log("agent_tool_ledger columns:", JSON.stringify(cols.map((c) => c.column_name)));

  const ledger = await sql`
    SELECT * FROM agent_tool_ledger WHERE thread_id = ${threadId} ORDER BY completed_at DESC LIMIT 50
  `;
  console.log("ledger rows:", ledger.length);
  console.log(JSON.stringify(ledger, null, 2).slice(0, 8000));

  const eventCols = await sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'agent_run_events'
  `;
  console.log("agent_run_events columns:", JSON.stringify(eventCols.map((c) => c.column_name)));
} catch (e) {
  console.error("ERR", e.message);
} finally {
  await sql.end({ timeout: 1 });
}
