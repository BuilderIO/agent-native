/**
 * Trash one or more emails by ID.
 *
 * Usage:
 *   pnpm script trash-email --id=msg123
 *   pnpm script trash-email --id=msg123,msg456
 *
 * Options:
 *   --id    Email ID(s) to trash, comma-separated (required)
 */

import { parseArgs, output, fatal } from "./helpers.js";

const API_BASE = "http://localhost:8080";

export default async function main(): Promise<void> {
  const args = parseArgs();
  const ids = args.id?.split(",").map((s) => s.trim()).filter(Boolean);

  if (!ids || ids.length === 0) {
    fatal("--id is required. Usage: pnpm script trash-email --id=msg123");
  }

  const results: { id: string; success: boolean; error?: string }[] = [];

  for (const id of ids) {
    try {
      const res = await fetch(`${API_BASE}/api/emails/${id}/trash`, {
        method: "PATCH",
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        results.push({ id, success: false, error: body?.error || `HTTP ${res.status}` });
      } else {
        results.push({ id, success: true });
      }
    } catch (err: any) {
      results.push({ id, success: false, error: err?.message || "Connection failed" });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.error(`Trashed ${succeeded}/${ids.length} email(s)${failed > 0 ? ` (${failed} failed)` : ""}`);
  output(results);
}
