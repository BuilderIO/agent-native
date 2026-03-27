import fs from "fs/promises";
import path from "path";
import { parseArgs } from "@agent-native/core";
import type { ScriptTool } from "@agent-native/core";
import type { ImportRecord } from "../shared/types.js";

const IMPORTS_DIR = path.join(process.cwd(), "data", "imports");

export const tool: ScriptTool = {
  description:
    "List all imported CSV datasets. Shows filename, row count, columns, and upload date for each import.",
  parameters: {
    type: "object",
    properties: {
      verbose: {
        type: "string",
        description: "Set to 'true' to include column names (default: false)",
        enum: ["true", "false"],
      },
    },
  },
};

async function listImportFiles(): Promise<ImportRecord[]> {
  try {
    const entries = await fs.readdir(IMPORTS_DIR);
    const jsonFiles = entries.filter((f) => f.endsWith(".json"));
    const records: ImportRecord[] = [];
    for (const file of jsonFiles) {
      try {
        const raw = await fs.readFile(path.join(IMPORTS_DIR, file), "utf8");
        records.push(JSON.parse(raw) as ImportRecord);
      } catch {
        // skip malformed files
      }
    }
    return records.sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    );
  } catch {
    return [];
  }
}

export async function run(args: Record<string, string>): Promise<string> {
  const verbose = args.verbose === "true";
  const imports = await listImportFiles();

  if (imports.length === 0) {
    return "No imports found. Upload a CSV file first.";
  }

  const lines = [`Found ${imports.length} import(s):`, ""];
  for (const imp of imports) {
    lines.push(`• ${imp.filename} (id: ${imp.id})`);
    lines.push(`  Rows: ${imp.rowCount} | Uploaded: ${imp.uploadedAt}`);
    if (verbose) {
      lines.push(`  Columns: ${imp.columns.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export default async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await run(args);
  console.log(result);
}
