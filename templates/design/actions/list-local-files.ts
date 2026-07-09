/**
 * list-local-files — list files under a connected local app's root via the
 * design bridge.
 *
 * Security gates (in order), mirroring write-local-file.ts minus the write
 * grant (reads do not require user write consent, only editor access + a
 * valid bridge connection):
 *  1. assertAccess: the caller must have editor access to the design.
 *  2. Bridge URL resolution: only the current user's own connection row.
 *  3. Loopback check: bridgeUrl must resolve to localhost/127.0.0.1.
 *  4. Bridge token: the connection's stored bridge token is sent as
 *     X-Bridge-Token so the bridge can reject unauthorized callers.
 */

import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
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
    "List files under a connected local app's root via the localhost design " +
    "bridge. Read-only — does not require a write-consent grant, but does " +
    "require editor access on the design and a running bridge connection. " +
    "Returns root-relative paths and sizes, already filtered by the bridge's " +
    ".gitignore-aware ignore rules, binary/size limits, and secret-path " +
    "blocklist (.env*, *.pem, *.key, id_rsa*, .git/).",
  schema: z.object({
    designId: z.string().describe("Design ID."),
    connectionId: z.string().describe("Localhost connection ID."),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId, connectionId }) => {
    await assertAccess("design", designId, "editor");

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() ?? null;

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
          orgId
            ? eq(schema.designLocalhostConnections.orgId, orgId)
            : isNull(schema.designLocalhostConnections.orgId),
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
    const res = await fetch(`${bridgeUrl}/list-files`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-Token": connection.bridgeToken,
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Bridge list-files failed (${res.status}): ${errText}`);
    }
    const body = (await res.json()) as {
      files?: Array<{ path: string; size: number }>;
      truncated?: boolean;
    };

    return {
      designId,
      connectionId,
      files: body.files ?? [],
      truncated: body.truncated ?? false,
    };
  },
});
