/**
 * SQL persistence for signed, content-only recap PNG images.
 *
 * The PR visual-recap GitHub Action renders a recap plan to a PNG and uploads
 * it through `POST /_agent-native/recap-image` (authenticated with the same
 * `agent-native connect` bearer token the MCP / action surface accepts). The
 * stored bytes are then served anonymously from
 * `GET /_agent-native/recap-image/<token>.png` so GitHub's camo image proxy can
 * fetch them into a (private-repo) PR comment without a login. The interactive
 * plan itself stays login-gated; this store only ever holds opaque image bytes
 * keyed by a long, unguessable token.
 *
 * Follows the same raw-SQL pattern as observability/store.ts and usage/store.ts
 * — framework-owned tables use `getDbExec()` with Postgres
 * `CREATE TABLE IF NOT EXISTS` DDL (additive only; never drops/renames/alters)
 * rather than Drizzle ORM, which is reserved for template-level schemas. The
 * PNG is stored as base64 TEXT so it does not need binary column handling.
 */
import { randomBytes } from "node:crypto";

import { getDbExec } from "../db/client.js";
import { ensureTableExists } from "../db/ddl-guard.js";

export const RECAP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const RECAP_IMAGE_CONTENT_TYPE = "image/png";

export const RECAP_IMAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Token format for the public `<token>.png` path. Hex-only so it can never
 * contain a path separator, `.`, or `..` — no directory traversal is possible
 * via the token path param.
 */
const TOKEN_PATTERN = /^[0-9a-f]{32,128}$/;

let _initPromise: Promise<void> | undefined;

function buildRecapImagesCreateSql(): string {
  return `
        CREATE TABLE IF NOT EXISTS recap_images (
          token TEXT PRIMARY KEY,
          png_base64 TEXT NOT NULL,
          content_type TEXT NOT NULL DEFAULT '${RECAP_IMAGE_CONTENT_TYPE}',
          byte_length BIGINT NOT NULL DEFAULT 0,
          owner_email TEXT,
          created_at BIGINT NOT NULL
        )
      `;
}

export async function ensureRecapImageTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const recapImagesCreateSql = buildRecapImagesCreateSql();
      await ensureTableExists("recap_images", recapImagesCreateSql);
    })().catch((error) => {
      _initPromise = undefined;
      throw error;
    });
  }
  return _initPromise;
}

export async function pruneExpiredRecapImages(
  now: number = Date.now(),
): Promise<number> {
  await ensureRecapImageTable();
  const client = getDbExec();
  const { rowsAffected } = await client.execute({
    sql: `DELETE FROM recap_images WHERE created_at < ?`,
    args: [now - RECAP_IMAGE_TTL_MS],
  });
  return rowsAffected;
}

export function generateRecapImageToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("hex");
}

export function isValidRecapImageToken(
  token: string | undefined | null,
): boolean {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

export interface StoredRecapImage {
  bytes: Buffer;
  contentType: string;
}

export async function saveRecapImage(
  png: Buffer,
  options: { ownerEmail?: string | null } = {},
): Promise<{ token: string }> {
  if (png.byteLength > RECAP_IMAGE_MAX_BYTES) {
    throw new Error("recap image exceeds maximum size");
  }
  await ensureRecapImageTable();
  const client = getDbExec();
  const token = generateRecapImageToken();
  await client.execute({
    sql: `INSERT INTO recap_images
      (token, png_base64, content_type, byte_length, owner_email, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      token,
      png.toString("base64"),
      RECAP_IMAGE_CONTENT_TYPE,
      png.byteLength,
      options.ownerEmail ?? null,
      Date.now(),
    ],
  });
  await pruneExpiredRecapImages().catch(() => {});
  return { token };
}

/**
 * Load a stored image by token. Returns `null` for an unknown or malformed
 * token. Never returns anything but the opaque image bytes — no plan data.
 */
export async function getRecapImage(
  token: string,
): Promise<StoredRecapImage | null> {
  if (!isValidRecapImageToken(token)) return null;
  await ensureRecapImageTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT png_base64, content_type FROM recap_images WHERE token = ? LIMIT 1`,
    args: [token],
  });
  const row = rows[0] as
    | { png_base64?: unknown; content_type?: unknown }
    | undefined;
  if (!row || typeof row.png_base64 !== "string") return null;
  return {
    bytes: Buffer.from(row.png_base64, "base64"),
    contentType:
      typeof row.content_type === "string"
        ? row.content_type
        : RECAP_IMAGE_CONTENT_TYPE,
  };
}
