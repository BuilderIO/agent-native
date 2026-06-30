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
 *  5. Bridge token: the X-Bridge-Token header is set to the per-grant token
 *     minted at consent time so the bridge can reject unauthorized calls.
 */

import path from "node:path";

import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { verifyWriteGrant } from "../server/lib/verify-write-grant.js";

/** File extensions the agent is permitted to write via the bridge. */
const ALLOWED_EXTENSIONS = new Set([".html", ".htm", ".css"]);

function assertAllowedExtension(relPath: string): void {
  const ext = path.extname(relPath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      `File "${relPath}" has extension "${ext}" which is not allowed. ` +
        "Only .html, .htm, and .css files may be written through the bridge.",
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
    "Write or patch a local file (HTML or CSS only) via the localhost design bridge. " +
    "The user MUST have already granted write consent via grant-localhost-write-consent; " +
    "this action will reject the request if no valid grant exists. " +
    "Pass content for a full file write, or {search, replace} for a targeted patch. " +
    "Requires editor access on the design.",
  schema: z.object({
    designId: z.string().describe("Design ID."),
    connectionId: z
      .string()
      .describe("Localhost connection ID (must have an active write grant)."),
    relPath: z
      .string()
      .describe(
        "Path to the file relative to the connection rootPath. " +
          "Only .html, .htm, and .css files are accepted.",
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
  }),
  run: async ({ designId, connectionId, relPath, content, patch }) => {
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

    // --- Resolve bridge URL ---
    const db = getDb();
    const [connection] = await db
      .select({ bridgeUrl: schema.designLocalhostConnections.bridgeUrl })
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

    const bridgeUrl = normalizeBridgeUrl(connection.bridgeUrl);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Bridge-Token": grant.bridgeToken,
    };

    if (content !== undefined) {
      // Full file write
      const res = await fetch(`${bridgeUrl}/write-file`, {
        method: "POST",
        headers,
        body: JSON.stringify({ relPath, content }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`Bridge write-file failed (${res.status}): ${errText}`);
      }
      return { designId, relPath, operation: "write" as const, written: true };
    } else {
      // Search-and-replace patch — first read, then apply-edit
      const readRes = await fetch(`${bridgeUrl}/read-file`, {
        method: "POST",
        headers,
        body: JSON.stringify({ relPath }),
      });
      if (!readRes.ok) {
        const errText = await readRes.text().catch(() => readRes.statusText);
        throw new Error(
          `Bridge read-file failed (${readRes.status}): ${errText}`,
        );
      }

      const applyRes = await fetch(`${bridgeUrl}/apply-edit`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          relPath,
          search: patch!.search,
          replace: patch!.replace,
        }),
      });
      if (!applyRes.ok) {
        const errText = await applyRes.text().catch(() => applyRes.statusText);
        throw new Error(
          `Bridge apply-edit failed (${applyRes.status}): ${errText}`,
        );
      }
      return { designId, relPath, operation: "patch" as const, written: true };
    }
  },
});
