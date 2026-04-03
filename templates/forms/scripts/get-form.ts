/**
 * Get a single form by ID with all fields and settings.
 *
 * Usage:
 *   pnpm script get-form --id <form-id>
 */

import { eq, sql } from "drizzle-orm";
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
  const { id, help } = parseArgs(args);

  if (help) {
    console.log("Usage: pnpm script get-form --id <form-id>");
    return;
  }

  if (!id) {
    console.error("Error: --id is required");
    process.exit(1);
  }

  const db = getDb();
  const form = await db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, id))
    .get();

  if (!form) {
    console.error(`Error: Form ${id} not found`);
    process.exit(1);
  }

  const responseCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.responses)
    .where(eq(schema.responses.formId, id))
    .get();

  const result = {
    id: form.id,
    title: form.title,
    description: form.description,
    slug: form.slug,
    status: form.status,
    fields: JSON.parse(form.fields),
    settings: JSON.parse(form.settings),
    responseCount: responseCount?.count ?? 0,
    createdAt: form.createdAt,
    updatedAt: form.updatedAt,
  };

  console.log(JSON.stringify(result, null, 2));
}
