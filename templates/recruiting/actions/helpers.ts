// Load .env in CLI mode (not needed when running via Vite dev server)
try {
  await import("dotenv/config");
} catch {
  // dotenv not available in Vite SSR context — env is already loaded
}

/** Parse CLI args like --key=value or --flag into a Record */
export function parseArgs(
  argv = process.argv.slice(2),
): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of argv.filter((a) => a !== "--")) {
    const match = arg.match(/^--(\w[\w-]*)=(.*)$/);
    if (match) {
      args[match[1]] = match[2];
    } else if (arg.startsWith("--")) {
      args[arg.slice(2)] = "true";
    }
  }
  return args;
}

/**
 * Print result as JSON to stdout with optional built-in filtering.
 * Supports --grep=<term> and --fields=<a,b,c> universal flags.
 */
export function output(data: unknown): void {
  const args = parseArgs();
  let result = data;
  if (args.grep) result = grepFilter(result, args.grep);
  if (args.fields)
    result = pickFields(
      result,
      args.fields.split(",").map((f) => f.trim()),
    );
  console.log(JSON.stringify(result, null, 2));
}

/** Print error and exit with code 1 */
export function fatal(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function matchesGrep(obj: unknown, term: string): boolean {
  const lower = term.toLowerCase();
  if (typeof obj === "string") return obj.toLowerCase().includes(lower);
  if (typeof obj === "number") return String(obj).includes(lower);
  if (Array.isArray(obj)) return obj.some((item) => matchesGrep(item, term));
  if (obj && typeof obj === "object")
    return Object.values(obj).some((v) => matchesGrep(v, term));
  return false;
}

function grepFilter(data: unknown, term: string): unknown {
  if (Array.isArray(data))
    return data.filter((item) => matchesGrep(item, term));
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
    const picked: Record<string, unknown> = {};
    for (const f of fields) {
      if (f in (obj as Record<string, unknown>))
        picked[f] = (obj as Record<string, unknown>)[f];
    }
    return picked;
  };
  if (Array.isArray(data)) return data.map(pick);
  return data;
}

/** Fetch from the local API server */
export async function localFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const port = process.env.PORT || "8080";
  const res = await fetch(`http://localhost:${port}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}
