try {
  const dotenv = await import("dotenv");
  dotenv.config({ quiet: true });
} catch {
  // dotenv not available in Vite SSR context — env is already loaded
}

export function parseArgs(
  argv = process.argv.slice(2),
): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eqIdx = arg.indexOf("=");
    if (eqIdx !== -1) {
      args[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
    } else {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }
  return args;
}

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

export function fatal(message: string): never {
  throw new Error(message);
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


import { getDbExec } from "@agent-native/core/db";
import { getRequestUserEmail } from "@agent-native/core/server";

/**
 * Resolve the current user's email for OAuth token lookups.
 * Prefers the per-request ALS context (falls back to AGENT_USER_EMAIL for
 * CLI invocations), then the most recent DB session for unattended scripts.
 * Never cached at module scope — concurrent requests on a Node.js process
 * would otherwise share one user's identity.
 */
export async function resolveOwnerEmail(): Promise<string> {
  const fromRequest = getRequestUserEmail();
  if (fromRequest) return fromRequest;

  try {
    const db = getDbExec();
    const { rows } = await db.execute({
      sql: "SELECT email FROM sessions ORDER BY created_at DESC LIMIT 1",
      args: [],
    });
    if (rows[0]) {
      const email = rows[0].email as string;
      if (email) return email;
    }
  } catch {
    // sessions table may not exist yet
  }

  throw new Error("no authenticated user");
}


import { gmailListLabels } from "../server/lib/google-api.js";
import { getClientsWithErrors } from "../server/lib/google-auth.js";

export async function getAccessTokens(
  ownerEmail?: string,
): Promise<Array<{ email: string; accessToken: string }>> {
  const resolvedOwnerEmail = ownerEmail ?? (await resolveOwnerEmail());
  const { clients, errors } = await getClientsWithErrors(resolvedOwnerEmail);
  if (clients.length === 0 && errors.length > 0) {
    throw new Error("Unable to resolve a connected Gmail account.");
  }
  return clients.map(({ email, accessToken }) => ({ email, accessToken }));
}

export async function fetchLabelMap(
  accessToken: string,
): Promise<Map<string, string>> {
  const res = await gmailListLabels(accessToken);
  const map = new Map<string, string>();
  for (const label of res.labels || []) {
    if (label.id && label.name) {
      map.set(label.id, label.name);
    }
  }
  return map;
}
