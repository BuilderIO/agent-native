/**
 * read-local-file — read one file from a connected local app via the design
 * bridge.
 *
 * Security gates (in order), mirroring write-local-file.ts minus the write
 * grant (reads do not require user write consent, only editor access + a
 * valid bridge connection):
 *  1. assertAccess: the caller must have editor access to the design.
 *  2. Bridge URL resolution: only the current user's own connection row.
 *  3. Loopback check: bridgeUrl must resolve to localhost/127.0.0.1.
 *  4. Bridge token: the connection's stored bridge token is sent as
 *     X-Bridge-Token so the bridge can reject unauthorized callers. The
 *     bridge itself additionally blocks secret-looking paths (.env*, *.pem,
 *     *.key, id_rsa*, anything under .git/) regardless of this grant.
 */

import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

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
    "Read one file's content from a connected local app via the localhost " +
    "design bridge. Read-only — does not require a write-consent grant, but " +
    "does require editor access on the design and a running bridge " +
    "connection. The bridge blocks secret-looking paths (.env*, *.pem, " +
    "*.key, id_rsa*, anything under .git/) even for callers with editor access.",
  schema: z.object({
    designId: z.string().describe("Design ID."),
    connectionId: z.string().describe("Localhost connection ID."),
    path: z
      .string()
      .describe("Path to the file relative to the connection rootPath."),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId, connectionId, path: relPath }) => {
    await assertAccess("design", designId, "editor");

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

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
    if (!connection.bridgeToken) {
      throw new Error(
        `No bridge token found for connection "${connectionId}". ` +
          "Reconnect via npx @agent-native/core@latest design connect.",
      );
    }

    const bridgeUrl = normalizeBridgeUrl(connection.bridgeUrl);
    const res = await fetch(`${bridgeUrl}/read-file`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-Token": connection.bridgeToken,
      },
      body: JSON.stringify({ relPath }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Bridge read-file failed (${res.status}): ${errText}`);
    }
    const body = (await res.json()) as {
      content?: string;
      versionHash?: string;
    };

    return {
      designId,
      connectionId,
      path: relPath,
      content: body.content ?? "",
      versionHash: body.versionHash,
      readonly: false,
    };
  },
});
