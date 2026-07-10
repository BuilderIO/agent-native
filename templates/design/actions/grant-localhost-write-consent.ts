import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

/** Grant expiry: 8 hours from mint time. */
const GRANT_TTL_MS = 8 * 60 * 60 * 1000;

export default defineAction({
  description:
    "Record the user's explicit consent to allow the agent to write local files " +
    "for a specific design + localhost connection. The grant scopes writes to the " +
    "connection's rootPath and expires after 8 hours. Requires editor access on the design. " +
    "The LocalhostWriteConsentDialog calls this after the user clicks 'Allow writes'.",
  // This action persists the real bridgeToken that unlocks the local
  // bridge's unrestricted /read-file, /write-file, and /apply-edit. It must
  // only ever be triggered by a human clicking "Allow writes" in
  // LocalhostWriteConsentDialog — never by the agent itself, or an agent
  // could self-grant local filesystem write/read access and bypass the
  // human consent model entirely. `agentTool: false` hides it from every
  // agent tool surface (in-app assistant, MCP, A2A) while keeping it
  // callable from the frontend via `callAction` / `useActionMutation` and
  // the raw `/_agent-native/actions/grant-localhost-write-consent` route. The
  // token intentionally stays server-side: browser callers only need grant
  // metadata because write-local-file adds bridge authentication itself.
  agentTool: false,
  schema: z.object({
    designId: z.string().describe("Design ID."),
    connectionId: z
      .string()
      .describe("Localhost connection ID (from list-localhost-connections)."),
  }),
  run: async ({ designId, connectionId }) => {
    await assertAccess("design", designId, "editor");

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() ?? null;

    const db = getDb();

    // Fetch the connection to get rootPath and the real bridgeToken that the
    // CLI registered when it started the bridge process.
    const [connection] = await db
      .select()
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

    if (!connection) {
      throw new Error(
        `Localhost connection "${connectionId}" not found for the current user.`,
      );
    }

    const rootPath = connection.rootPath;
    if (!rootPath) {
      throw new Error(
        `Connection "${connectionId}" has no rootPath. ` +
          "Re-run `npx @agent-native/core@latest design connect` to record the root path.",
      );
    }

    const bridgeToken = connection.bridgeToken;
    if (!bridgeToken) {
      throw new Error(
        `Connection "${connectionId}" has no bridge token. ` +
          "Re-run `npx @agent-native/core@latest design connect` so the CLI can register the real bridge token.",
      );
    }

    const now = new Date();
    const grantId = nanoid();
    const grantedUntil = new Date(now.getTime() + GRANT_TTL_MS).toISOString();
    const nowIso = now.toISOString();

    // Upsert: if a grant already exists for this design+connection+user, replace it.
    const [existing] = await db
      .select({ id: schema.designLocalhostWriteGrants.id })
      .from(schema.designLocalhostWriteGrants)
      .where(
        and(
          eq(schema.designLocalhostWriteGrants.designId, designId),
          eq(schema.designLocalhostWriteGrants.connectionId, connectionId),
          eq(schema.designLocalhostWriteGrants.ownerEmail, ownerEmail),
          orgId
            ? eq(schema.designLocalhostWriteGrants.orgId, orgId)
            : isNull(schema.designLocalhostWriteGrants.orgId),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(schema.designLocalhostWriteGrants)
        .set({ bridgeToken, grantedUntil, rootPath })
        .where(eq(schema.designLocalhostWriteGrants.id, existing.id));
    } else {
      await db.insert(schema.designLocalhostWriteGrants).values({
        id: grantId,
        designId,
        connectionId,
        rootPath,
        bridgeToken,
        grantedUntil,
        ownerEmail,
        orgId,
        createdAt: nowIso,
      });
    }

    return {
      grantId: existing?.id ?? grantId,
      rootPath,
      grantedUntil,
    };
  },
});
