// Load .env in CLI mode (not needed when running via Vite dev server)
try {
  await import("dotenv/config");
} catch {
  // dotenv not available in Vite SSR context — env is already loaded
}

import { parseArgs as coreParseArgs } from "@agent-native/core/scripts";

/** Parse CLI args like --key=value into a Record */
export function parseArgs(
  argv = process.argv.slice(2),
): Record<string, string> {
  return coreParseArgs(argv);
}

/**
 * Print result as JSON to stdout, with optional built-in filtering.
 *
 * Supports two universal flags (parsed from CLI automatically):
 *   --grep=<term>       Case-insensitive search across all string values.
 *                        Filters arrays to matching items, or checks the whole object.
 *   --fields=<a,b,c>    Comma-separated list of fields to pluck from each result object.
 *
 * Examples:
 *   pnpm action hubspot-deals --grep=enterprise
 *   pnpm action hubspot-deals --grep=enterprise --fields=dealname,amount,stageLabel
 */
export function output(data: unknown): void {
  const args = parseArgs();
  let result = data;

  if (args.grep) {
    result = grepFilter(result, args.grep);
  }
  if (args.fields) {
    result = pickFields(
      result,
      args.fields.split(",").map((f) => f.trim()),
    );
  }

  console.log(JSON.stringify(result, null, 2));
}

/** Print an error and exit */
export function fatal(message: string): never {
  throw new Error(message);
}

function matchesGrep(obj: unknown, term: string): boolean {
  const lower = term.toLowerCase();
  if (typeof obj === "string") return obj.toLowerCase().includes(lower);
  if (typeof obj === "number") return String(obj).includes(lower);
  if (Array.isArray(obj)) return obj.some((item) => matchesGrep(item, term));
  if (obj && typeof obj === "object") {
    return Object.values(obj).some((v) => matchesGrep(v, term));
  }
  return false;
}

function grepFilter(data: unknown, term: string): unknown {
  if (Array.isArray(data)) {
    return data.filter((item) => matchesGrep(item, term));
  }
  if (data && typeof data === "object") {
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      data as Record<string, unknown>,
    )) {
      if (Array.isArray(value)) {
        const matches = value.filter((item) => matchesGrep(item, term));
        if (matches.length > 0) filtered[key] = matches;
      } else if (matchesGrep(value, term)) {
        filtered[key] = value;
      }
    }
    return filtered;
  }
  return data;
}

function pickFields(data: unknown, fields: string[]): unknown {
  const pick = (obj: unknown): unknown => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
    const flat = flattenForPick(obj as Record<string, unknown>);
    const picked: Record<string, unknown> = {};
    for (const f of fields) {
      if (f in flat) picked[f] = flat[f];
    }
    return picked;
  };

  if (Array.isArray(data)) return data.map(pick);
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (Array.isArray(value)) {
        result[key] = value.map(pick);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  return data;
}

function flattenForPick(obj: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = { ...obj };
  for (const [, value] of Object.entries(obj)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(flat, value as Record<string, unknown>);
    }
  }
  return flat;
}
