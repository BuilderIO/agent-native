import fs from "fs/promises";
import path from "path";
import { defineEventHandler } from "h3";
import type { ImportRecord } from "../../../../shared/types.js";

const IMPORTS_DIR = path.join(process.cwd(), "data", "imports");

export default defineEventHandler(async () => {
  let entries: string[];
  try {
    entries = await fs.readdir(IMPORTS_DIR);
  } catch {
    return [];
  }

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

  records.sort(
    (a, b) =>
      new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
  );

  return records;
});
