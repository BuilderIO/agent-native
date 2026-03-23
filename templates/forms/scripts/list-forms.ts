import { sql } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}

export default async function main(args: string[]) {
  const { status, help } = parseArgs(args);

  if (help) {
    console.log(
      "Usage: pnpm script list-forms [--status draft|published|closed]",
    );
    return;
  }

  const db = getDb();
  const rows = await db.select().from(schema.forms).all();
  const filtered = status ? rows.filter((r) => r.status === status) : rows;

  // Get response counts
  const counts = await db
    .select({
      formId: schema.responses.formId,
      count: sql<number>`count(*)`,
    })
    .from(schema.responses)
    .groupBy(schema.responses.formId)
    .all();
  const countMap = new Map(counts.map((c) => [c.formId, c.count]));

  console.log(`\nForms (${filtered.length}):\n`);
  for (const form of filtered) {
    const responseCount = countMap.get(form.id) || 0;
    console.log(`  [${form.status}] ${form.title}`);
    console.log(
      `    ID: ${form.id} | Slug: ${form.slug} | Responses: ${responseCount}`,
    );
    console.log(`    Created: ${form.createdAt}\n`);
  }
}
