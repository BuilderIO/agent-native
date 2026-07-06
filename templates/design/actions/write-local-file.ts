/**
 * write-local-file — write or patch a local file through the design bridge.
 *
 * Security gates (in order):
 *  1. assertAccess: the caller must have editor access to the design.
 *  2. File extension: only .html, .htm, and .css files are allowed.
 *  3. verifyWriteGrant: a valid (non-expired) user-approved write-consent grant
 *     must exist. The agent CANNOT bypass this check.
 *  4. Path confinement: assertPathInside ensures the target stays inside
 *     rootPath (pre-bridge check; bridge also validates with realpath).
 *  5. Bridge token: the X-Bridge-Token header is set to the connection's
 *     CURRENT bridge token (falling back to the token snapshotted on the
 *     grant). The CLI mints a fresh token on every bridge start, so a bridge
 *     restart + reconnect rotates the connection token while the user's
 *     time-boxed consent grant stays valid; preferring the connection token
 *     keeps writes working across restarts. A bridge 401/403 is surfaced as a
 *     specific stale-token error telling the user to re-run design connect
 *     and re-grant write consent.
 */

import path from "node:path";

import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { verifyWriteGrant } from "../server/lib/verify-write-grant.js";

/**
 * Text/code file extensions the agent is permitted to write via the bridge.
 * Mirrors ALLOWED_WRITE_EXTENSIONS in the core design-connect bridge, which
 * enforces the same list plus a secret-path blocklist on its side.
 */
const ALLOWED_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".less",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".vue",
  ".svelte",
  ".astro",
  ".txt",
  ".yml",
  ".yaml",
  ".svg",
]);

/**
 * Secret-looking paths are never writable, regardless of extension. All
 * comparisons are case-insensitive: macOS's default filesystem (and Windows)
 * is case-insensitive, so ".ENV", "ID_RSA", or "KEY.PEM" refer to the exact
 * same on-disk file as their lowercase form and must be blocked identically.
 * Mirrors isBlockedSecretPath in packages/core/src/cli/design-connect.ts.
 */
function isBlockedSecretPath(relPath: string): boolean {
  const segments = relPath
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
  const basename = segments[segments.length - 1] ?? "";
  if (segments.some((segment) => segment === ".git")) return true;
  if (basename.startsWith(".env")) return true;
  if (basename.endsWith(".pem") || basename.endsWith(".key")) return true;
  if (basename.startsWith("id_rsa")) return true;
  return false;
}

function assertAllowedExtension(relPath: string): void {
  if (isBlockedSecretPath(relPath)) {
    throw new Error(
      `File "${relPath}" looks like a secret or VCS-internal file and may not be written through the bridge.`,
    );
  }
  const ext = path.extname(relPath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      `File "${relPath}" has extension "${ext}" which is not allowed. ` +
        "Only text and code files (HTML, CSS, JS/TS, JSON, Markdown, and similar) may be written through the bridge.",
    );
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  ) {
    return true;
  }
  const parts = normalized.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d+$/.test(part) && Number(part) <= 255)
  );
}

/**
 * Build the error for a failed bridge call. 401/403 means the bridge rejected
 * the token — after a bridge restart the CLI mints a fresh token, so a token
 * snapshotted at consent time goes stale even though the grant itself is
 * still valid. Surface that as a specific, actionable message instead of a
 * generic failure.
 */
function bridgeRequestError(
  operation: string,
  status: number,
  errText: string,
): Error {
  if (status === 401 || status === 403) {
    return new Error(
      `Bridge ${operation} rejected authentication (${status}). ` +
        "The stored bridge token is stale — the design bridge was likely restarted " +
        "since write consent was granted (each bridge start mints a fresh token). " +
        "Re-run `npx @agent-native/core@latest design connect` and re-grant write " +
        "consent, then retry.",
    );
  }
  return new Error(`Bridge ${operation} failed (${status}): ${errText}`);
}

function normalizeBridgeUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("bridgeUrl must be an http(s) URL");
  }
  if (parsed.username || parsed.password) {
    throw new Error("bridgeUrl must not include credentials");
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error("bridgeUrl must not include a path");
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error("bridgeUrl must use localhost or a loopback IP address");
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = "";
  return parsed.toString().replace(/\/$/, "");
}

export default defineAction({
  description:
    "Write or patch a local file via the localhost design bridge. Accepts " +
    "common text/code files: HTML, CSS, JS/TS/JSX/TSX, JSON, Markdown, YAML, " +
    "SVG, Vue/Svelte/Astro, and similar. Secret-looking paths (.env*, *.pem, " +
    "*.key, id_rsa*, anything under .git/) are always blocked, regardless of " +
    "extension. The user MUST have already granted write consent via " +
    "grant-localhost-write-consent; this action will reject the request if no " +
    "valid grant exists. Pass content for a full file write, or {search, " +
    "replace} for a targeted patch. Requires editor access on the design.",
  schema: z.object({
    designId: z.string().describe("Design ID."),
    connectionId: z
      .string()
      .describe("Localhost connection ID (must have an active write grant)."),
    relPath: z
      .string()
      .describe(
        "Path to the file relative to the connection rootPath. Common " +
          "text/code files are accepted (HTML, CSS, JS/TS/JSX/TSX, JSON, " +
          "Markdown, YAML, SVG, Vue/Svelte/Astro, and similar); " +
          "secret-looking paths are always rejected.",
      ),
    content: z
      .string()
      .optional()
      .describe(
        "Full replacement file content. Use for new files or complete rewrites.",
      ),
    patch: z
      .object({
        search: z
          .string()
          .describe("Exact text to search for (must appear exactly once)."),
        replace: z.string().describe("Replacement text."),
      })
      .optional()
      .describe(
        "Search-and-replace patch. Use for targeted edits. " +
          "Mutually exclusive with content.",
      ),
    expectedVersionHash: z
      .string()
      .optional()
      .describe(
        "Optional version hash previously returned by read-local-file or a " +
          "prior write. When provided, the bridge rejects the write with a " +
          "version-conflict error if the file changed on disk since that " +
          "hash was read.",
      ),
  }),
  run: async ({
    designId,
    connectionId,
    relPath,
    content,
    patch,
    expectedVersionHash,
  }) => {
    // --- Gate 1: access ---
    await assertAccess("design", designId, "editor");

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    // --- Gate 2: extension whitelist ---
    assertAllowedExtension(relPath);

    // --- Gate 3: valid write-consent grant ---
    const grant = await verifyWriteGrant({
      designId,
      connectionId,
      ownerEmail,
      targetPath: relPath,
    });

    // --- Gate 4: exactly one of content/patch must be provided ---
    if (content === undefined && patch === undefined) {
      throw new Error(
        "Either content (full file write) or patch (search/replace) must be provided.",
      );
    }
    if (content !== undefined && patch !== undefined) {
      throw new Error(
        "content and patch are mutually exclusive. Provide one or the other.",
      );
    }

    // --- Resolve bridge URL + current token ---
    const db = getDb();
    const [connection] = await db
      .select({
        bridgeUrl: schema.designLocalhostConnections.bridgeUrl,
        bridgeToken: schema.designLocalhostConnections.bridgeToken,
      })
      .from(schema.designLocalhostConnections)
      .where(
        and(
          eq(schema.designLocalhostConnections.id, connectionId),
          eq(schema.designLocalhostConnections.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);

    if (!connection?.bridgeUrl) {
      throw new Error(
        `No bridge URL found for connection "${connectionId}". ` +
          "Ensure the design bridge is running (npx @agent-native/core@latest design connect).",
      );
    }

    // Prefer the connection's CURRENT bridge token over the one snapshotted on
    // the grant: the CLI mints a fresh token on every bridge start, and a
    // later connect-localhost by the same authenticated user refreshes the
    // connection row. The user's time-boxed consent grant is unchanged — only
    // the transport token rotated — so writes keep working across restarts.
    const bridgeUrl = normalizeBridgeUrl(connection.bridgeUrl);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Bridge-Token": connection.bridgeToken || grant.bridgeToken,
    };

    if (content !== undefined) {
      // Full file write
      const res = await fetch(`${bridgeUrl}/write-file`, {
        method: "POST",
        headers,
        body: JSON.stringify({ relPath, content, expectedVersionHash }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          throw new Error(
            `version conflict: "${relPath}" changed on disk since it was last read.`,
          );
        }
        const errText = await res.text().catch(() => res.statusText);
        throw bridgeRequestError("write-file", res.status, errText);
      }
      const body = (await res.json().catch(() => ({}))) as {
        versionHash?: string;
      };
      return {
        designId,
        relPath,
        operation: "write" as const,
        written: true,
        versionHash: body.versionHash,
      };
    } else {
      // Search-and-replace patch. The bridge's /apply-edit validates the file
      // itself (404s on a missing file), so no pre-read round-trip is needed.
      const applyRes = await fetch(`${bridgeUrl}/apply-edit`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          relPath,
          search: patch!.search,
          replace: patch!.replace,
          expectedVersionHash,
        }),
      });
      if (!applyRes.ok) {
        if (applyRes.status === 409) {
          throw new Error(
            `version conflict: "${relPath}" changed on disk since it was last read.`,
          );
        }
        const errText = await applyRes.text().catch(() => applyRes.statusText);
        throw bridgeRequestError("apply-edit", applyRes.status, errText);
      }
      const body = (await applyRes.json().catch(() => ({}))) as {
        versionHash?: string;
      };
      return {
        designId,
        relPath,
        operation: "patch" as const,
        written: true,
        versionHash: body.versionHash,
      };
    }
  },
});
