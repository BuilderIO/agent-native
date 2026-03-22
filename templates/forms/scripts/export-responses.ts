import fs from "fs";
import { eq, desc } from "drizzle-orm";
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
  const { form: formId, output, format: fmt, help } = parseArgs(args);

  if (help) {
    console.log(
      "Usage: pnpm script export-responses --form <form-id> --output <path> [--format csv|json]",
    );
    return;
  }

  if (!formId) {
    console.error("Error: --form is required");
    process.exit(1);
  }

  const form = db.select().from(schema.forms).where(eq(schema.forms.id, formId)).get();
  if (!form) {
    console.error(`Error: Form ${formId} not found`);
    process.exit(1);
  }

  const responses = db
    .select()
    .from(schema.responses)
    .where(eq(schema.responses.formId, formId))
    .orderBy(desc(schema.responses.submittedAt))
    .all();

  const fields = JSON.parse(form.fields);
  const outputPath = output || `data/export-${formId}.${fmt === "json" ? "json" : "csv"}`;

  if (fmt === "json" || outputPath.endsWith(".json")) {
    const data = responses.map((r) => ({
      id: r.id,
      submittedAt: r.submittedAt,
      ...JSON.parse(r.data),
    }));
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  } else {
    // CSV
    const headers = ["ID", "Submitted At", ...fields.map((f: any) => f.label)];
    const rows = responses.map((r) => {
      const data = JSON.parse(r.data);
      return [
        r.id,
        r.submittedAt,
        ...fields.map((f: any) => {
          const val = data[f.id];
          if (Array.isArray(val)) return val.join("; ");
          return String(val ?? "");
        }),
      ];
    });

    const csv = [headers, ...rows]
      .map((row) =>
        row.map((cell: string) => `"${cell.replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");

    fs.writeFileSync(outputPath, csv);
  }

  console.log(`\nExported ${responses.length} responses to ${outputPath}`);
}
