import { customAlphabet } from "nanoid";

const nanoid = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
);
import { getDb, schema } from "../server/db/index.js";
import type { FormField, FormSettings } from "../shared/types.js";

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
  const { title, description, fields: fieldsJson, help } = parseArgs(args);

  if (help) {
    console.log(
      'Usage: pnpm action create-form --title "My Form" [--description "..."] [--fields \'[...]\']',
    );
    return;
  }

  if (!title) {
    console.error("Error: --title is required");
    throw new Error("Script failed");
  }

  const id = nanoid();
  const now = new Date().toISOString();
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) +
    "-" +
    id.slice(0, 6);

  let fields: FormField[] = [];
  if (fieldsJson) {
    try {
      fields = JSON.parse(fieldsJson);
    } catch {
      console.error("Error: --fields must be valid JSON");
      throw new Error("Script failed");
    }
  }

  const defaultSettings: FormSettings = {
    primaryColor: "#2563eb",
    backgroundColor: "#ffffff",
    fontFamily: "Inter",
    submitText: "Submit",
    successMessage: "Thank you! Your response has been recorded.",
    showProgressBar: false,
  };

  const db = getDb();
  await db
    .insert(schema.forms)
    .values({
      id,
      title,
      description: description || null,
      slug,
      fields: JSON.stringify(fields),
      settings: JSON.stringify(defaultSettings),
      status: "draft",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  console.log(`\nForm created successfully!`);
  console.log(`  ID: ${id}`);
  console.log(`  Title: ${title}`);
  console.log(`  Slug: ${slug}`);
  console.log(`  Status: draft`);
  console.log(
    `\n  To publish: pnpm action update-form --id ${id} --status published`,
  );
}
