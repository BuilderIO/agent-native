/**
 * Get a single email by ID.
 *
 * Usage:
 *   pnpm script get-email --id=msg123
 *
 * Options:
 *   --id    Email ID (required)
 */

import { parseArgs, output, fatal } from "./helpers.js";

const API_BASE = "http://localhost:8080";

export default async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.id) {
    fatal("--id is required. Usage: pnpm script get-email --id=msg123");
  }

  try {
    const res = await fetch(`${API_BASE}/api/emails/${args.id}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      fatal(`API error: ${body?.error || `HTTP ${res.status}`}`);
    }

    const email = await res.json();
    console.error(`Email: ${email.subject} from ${email.from?.name || email.from?.email}`);
    output(email);
  } catch (err: any) {
    fatal(`Could not connect to dev server at ${API_BASE}. Start it with: pnpm dev\n  (${err?.message})`);
  }
}
