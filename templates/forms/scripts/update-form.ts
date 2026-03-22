import { eq } from "drizzle-orm";
import { db, schema } from "../server/db/index.js";

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
  const {
    id,
    title,
    status,
    fields: fieldsJson,
    description,
    help,
  } = parseArgs(args);

  if (help) {
    console.log(
      "Usage: pnpm script update-form --id <id> [--title ...] [--status draft|published|closed] [--fields <json>] [--description ...]",
    );
    return;
  }

  if (!id) {
    console.error("Error: --id is required");
    process.exit(1);
  }

  const existing = db
    .select()
    .from(schema.forms)
    .where(eq(schema.forms.id, id))
    .get();

  if (!existing) {
    console.error(`Error: Form ${id} not found`);
    process.exit(1);
  }

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (title) updates.title = title;
  if (description) updates.description = description;
  if (status) updates.status = status;
  if (fieldsJson) {
    try {
      JSON.parse(fieldsJson);
      updates.fields = fieldsJson;
    } catch {
      console.error("Error: --fields must be valid JSON");
      process.exit(1);
    }
  }

  db.update(schema.forms).set(updates).where(eq(schema.forms.id, id)).run();

  console.log(`\nForm updated successfully!`);
  console.log(`  ID: ${id}`);
  if (title) console.log(`  Title: ${title}`);
  if (status) console.log(`  Status: ${status}`);
}
