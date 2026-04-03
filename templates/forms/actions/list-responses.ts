import { eq, desc, sql } from "drizzle-orm";
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
  const { form: formId, limit: limitStr, help } = parseArgs(args);

  if (help) {
    console.log(
      "Usage: pnpm action list-responses --form <form-id> [--limit N]",
    );
    return;
  }

  if (!formId) {
    console.error("Error: --form is required");
    process.exit(1);
  }

  const db = getDb();
  const form = await db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, formId))
    .get();
  if (!form) {
    console.error(`Error: Form ${formId} not found`);
    process.exit(1);
  }

  const limit = parseInt(limitStr || "50", 10);
  const responses = await db
    .select()
    .from(schema.responses)
    .where(eq(schema.responses.formId, formId))
    .orderBy(desc(schema.responses.submittedAt))
    .limit(limit)
    .all();

  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.responses)
    .where(eq(schema.responses.formId, formId))
    .get();

  const fields = JSON.parse(form.fields);

  console.log(
    `\nResponses for "${form.title}" (${total?.count ?? 0} total, showing ${responses.length}):\n`,
  );

  for (const response of responses) {
    const data = JSON.parse(response.data);
    console.log(`  Response ${response.id} — ${response.submittedAt}`);
    for (const field of fields) {
      const val = data[field.id];
      console.log(
        `    ${field.label}: ${Array.isArray(val) ? val.join(", ") : (val ?? "-")}`,
      );
    }
    console.log("");
  }
}
