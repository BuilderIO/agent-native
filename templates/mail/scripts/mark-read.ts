/**
 * Mark one or more emails as read or unread.
 *
 * Usage:
 *   pnpm script mark-read --id=msg123
 *   pnpm script mark-read --id=msg123,msg456 --unread
 *
 * Options:
 *   --id      Email ID(s), comma-separated (required)
 *   --unread  Mark as unread instead of read
 */

import { parseArgs, output, fatal } from "./helpers.js";

const API_BASE = "http://localhost:8080";

export default async function main(): Promise<void> {
  const args = parseArgs();
  const ids = args.id?.split(",").map((s) => s.trim()).filter(Boolean);
  const markUnread = args.unread === "true";

  if (!ids || ids.length === 0) {
    fatal("--id is required. Usage: pnpm script mark-read --id=msg123 [--unread]");
  }

  const results: { id: string; success: boolean; error?: string }[] = [];

  for (const id of ids) {
    try {
      const res = await fetch(`${API_BASE}/api/emails/${id}/read`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: !markUnread }),
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

  const action = markUnread ? "unread" : "read";
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.error(`Marked ${succeeded}/${ids.length} email(s) as ${action}${failed > 0 ? ` (${failed} failed)` : ""}`);
  output(results);
}
