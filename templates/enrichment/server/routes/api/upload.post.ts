import { randomUUID } from "node:crypto";
import { createError, defineEventHandler, readMultipartFormData } from "h3";
import Papa from "papaparse";
import path from "path";
import type { ImportRecord } from "../../../shared/types.js";
import { writeJsonFile } from "../../lib/exa.js";

const IMPORTS_DIR = path.join(process.cwd(), "data", "imports");

function normalizeRow(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value == null ? "" : String(value);
  }
  return out;
}

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event);
  const filePart = parts?.find((p) => p.filename && p.data?.length);

  if (!filePart?.data) {
    throw createError({
      statusCode: 400,
      statusMessage: "No file uploaded",
    });
  }

  const text = filePart.data.toString("utf8");
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    dynamicTyping: false,
    header: true,
    skipEmptyLines: true,
  });

  const columns = (parsed.meta.fields ?? []).filter(
    (f): f is string => typeof f === "string" && f.length > 0,
  );
  const rows = (parsed.data as Record<string, unknown>[]).map(normalizeRow);

  const id = randomUUID();
  const record: ImportRecord = {
    id,
    filename: filePart.filename ?? "upload.csv",
    uploadedAt: new Date().toISOString(),
    columns,
    rows,
    rowCount: rows.length,
  };

  const filePath = path.join(IMPORTS_DIR, `${id}.json`);
  await writeJsonFile(filePath, record);

  return record;
});
