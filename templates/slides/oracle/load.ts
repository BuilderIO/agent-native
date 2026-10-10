import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { OracleFileSchema, type OracleFile, type OracleRow } from "./schema";

// Read from disk, not imported: the slides tsconfig does not enable
// resolveJsonModule, so a static JSON import would not typecheck.
export const ORACLE_FILE_NAMES = [
  "interaction-oracle.json",
  "interaction-oracle-gaps.json",
] as const;
export type OracleFileName = (typeof ORACLE_FILE_NAMES)[number];

export class OracleRowNotFoundError extends Error {
  readonly rowId: string;

  constructor(rowId: string) {
    super(`No interaction oracle row with id "${rowId}"`);
    this.name = "OracleRowNotFoundError";
    this.rowId = rowId;
  }
}

export function readOracleFile(fileName: OracleFileName): OracleFile {
  const path = fileURLToPath(new URL(fileName, import.meta.url));

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Cannot read interaction oracle file ${fileName}`, {
      cause: error,
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${fileName} is not valid JSON`, { cause: error });
  }

  const parsed = OracleFileSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new Error(
      `${fileName} failed schema validation:\n${issues.join("\n")}`,
    );
  }
  return parsed.data;
}

export function loadOracleRows(): OracleRow[] {
  const rows = ORACLE_FILE_NAMES.flatMap(
    (fileName) => readOracleFile(fileName).rows,
  );

  // getOracleRow returns the first match, so a duplicate would be silently shadowed.
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) {
      throw new Error(`Duplicate interaction oracle row id "${row.id}"`);
    }
    seen.add(row.id);
  }
  return rows;
}

export function findOracleRow(id: string): OracleRow | undefined {
  return loadOracleRows().find((row) => row.id === id);
}

export function getOracleRow(id: string): OracleRow {
  const row = findOracleRow(id);
  if (row === undefined) {
    throw new OracleRowNotFoundError(id);
  }
  return row;
}
