/**
 * Per-(viewer, tool, content_hash) consent storage for the tools sandbox.
 *
 * SECURITY (audit C1, security-audit/05-tools-sandbox.md):
 *
 * A tool is a row in `tools` whose `content` column is arbitrary HTML/JS
 * authored by `owner_email`. When a tool is shared with another user (or the
 * org), the recipient's iframe runs the AUTHOR's code in the VIEWER's session
 * — viewer secrets, viewer SQL scope, viewer action permissions. That is a
 * stored-XSS / stored-RCE primitive aimed at every user the tool reaches.
 *
 * Mitigation: before a non-author renders a shared tool, require explicit
 * consent. We pin consent to a SHA-256 of the rendered content so any
 * subsequent edit by the author re-prompts the viewer (consent is for THIS
 * exact content, not for the tool record forever).
 *
 * This module is the additive store. The HTTP gates live in `routes.ts`:
 *   GET  /_agent-native/tools/:id/render          → renders consent stub
 *   POST /_agent-native/tools/:id/grant-consent   → writes consent row
 */

import { createHash } from "node:crypto";
import { getDbExec } from "../db/client.js";
import { ensureToolsTables } from "./store.js";

/**
 * Compute the SHA-256 hash of a tool's rendered content. The hash is the
 * stable identity of "this exact tool body, on this exact day". Any author
 * edit produces a new hash, which forces the viewer to re-consent.
 */
export function computeContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Returns true if `viewerEmail` has an outstanding consent row for the
 * (toolId, contentHash) combination — meaning the viewer has previously
 * approved running this exact content. Author callers should NOT call this:
 * the author is implicitly trusted on their own tool. Callers must check
 * `tool.ownerEmail !== viewerEmail` first.
 */
export async function hasConsent(
  viewerEmail: string,
  toolId: string,
  contentHash: string,
): Promise<boolean> {
  await ensureToolsTables();
  const client = getDbExec();
  const result = await client.execute({
    sql: `SELECT viewer_email FROM tool_consents
          WHERE viewer_email = ? AND tool_id = ? AND content_hash = ?
          LIMIT 1`,
    args: [viewerEmail, toolId, contentHash],
  });
  return (result.rows ?? []).length > 0;
}

/**
 * Record that `viewerEmail` has approved running tool `toolId` at this
 * exact `contentHash`. Idempotent — re-grants update granted_at but never
 * fail. Always-additive: never deletes other rows for this tool.
 */
export async function grantConsent(
  viewerEmail: string,
  toolId: string,
  contentHash: string,
): Promise<void> {
  await ensureToolsTables();
  const client = getDbExec();
  const now = new Date().toISOString();
  // ON CONFLICT works on both Postgres and SQLite/libsql since we always
  // declare the PK in the CREATE statement (viewer_email, tool_id,
  // content_hash). On a duplicate row, refresh granted_at — that lets us
  // surface "most recent consent" if we ever expose a UI for viewers to
  // manage their consents.
  await client.execute({
    sql: `INSERT INTO tool_consents (viewer_email, tool_id, content_hash, granted_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (viewer_email, tool_id, content_hash)
          DO UPDATE SET granted_at = EXCLUDED.granted_at`,
    args: [viewerEmail, toolId, contentHash, now],
  });
}

/**
 * Revoke ALL consent rows for `viewerEmail` against tool `toolId`. Used by
 * the explicit "revoke" path (e.g. a viewer changes their mind, or the
 * framework wants to force re-prompt). Deletes only rows owned by this
 * viewer — never touches another user's grants.
 *
 * NOTE: this is an additive deletion (a viewer-scoped DELETE, not a
 * destructive schema op). It is the only place tool_consents rows go away.
 */
export async function revokeConsent(
  viewerEmail: string,
  toolId: string,
): Promise<void> {
  await ensureToolsTables();
  const client = getDbExec();
  await client.execute({
    sql: `DELETE FROM tool_consents WHERE viewer_email = ? AND tool_id = ?`,
    args: [viewerEmail, toolId],
  });
}

/** Convenience: list active consent hashes for a viewer × tool pair. */
export async function listConsentHashes(
  viewerEmail: string,
  toolId: string,
): Promise<string[]> {
  await ensureToolsTables();
  const client = getDbExec();
  const result = await client.execute({
    sql: `SELECT content_hash FROM tool_consents
          WHERE viewer_email = ? AND tool_id = ?
          ORDER BY granted_at DESC`,
    args: [viewerEmail, toolId],
  });
  return (result.rows ?? []).map((r: any) => String(r.content_hash));
}
