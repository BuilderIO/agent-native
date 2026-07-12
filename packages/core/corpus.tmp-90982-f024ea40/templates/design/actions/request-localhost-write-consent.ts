import { defineAction } from "@agent-native/core";
import {
  readAppStateForCurrentTab,
  writeAppState,
} from "@agent-native/core/application-state";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

/**
 * Surface the LocalhostWriteConsentDialog so the user can approve local file
 * writes. Granting is human-only (`grant-localhost-write-consent` is
 * `agentTool: false`), so an agent writing from chat can only *request* the
 * prompt: this writes an app-state key the editor observes and opens the dialog.
 * If a valid grant already exists it reports that instead of prompting again.
 */
export default defineAction({
  description:
    "Prompt the user to allow local file writes for a design's localhost " +
    "connection by opening the write-consent dialog in the editor. Write " +
    "consent itself is human-only and cannot be granted by the agent. Call " +
    "this when write-local-file fails because no write-consent grant exists, " +
    "then retry write-local-file after the user approves. Requires editor " +
    "access on the design.",
  schema: z.object({
    designId: z.string().describe("Design ID."),
    connectionId: z
      .string()
      .describe("Localhost connection ID (from list-localhost-connections)."),
    files: z
      .array(z.string())
      .optional()
      .describe("File paths about to be written, shown in the dialog."),
  }),
  run: async ({ designId, connectionId, files }) => {
    await assertAccess("design", designId, "editor");

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() ?? null;

    const db = getDb();
    const [connection] = await db
      .select({
        rootPath: schema.designLocalhostConnections.rootPath,
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

    if (!connection) {
      throw new Error(
        `Localhost connection "${connectionId}" not found for the current user.`,
      );
    }

    // Fail fast on the same preconditions grant-localhost-write-consent
    // enforces, so we never show a dialog that would hard-fail on approval —
    // or one labeled with the connection id instead of a real folder.
    if (!connection.rootPath || !connection.bridgeToken) {
      throw new Error(
        `Connection "${connectionId}" is not ready for writes (missing root ` +
          "path or bridge token). Re-run `npx @agent-native/core@latest design " +
          "connect` so the CLI records both, then retry.",
      );
    }

    // Skip the prompt when a non-expired grant already covers this connection —
    // the agent can just retry write-local-file.
    const [grant] = await db
      .select({
        grantedUntil: schema.designLocalhostWriteGrants.grantedUntil,
      })
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
    if (grant && grant.grantedUntil > new Date().toISOString()) {
      return {
        designId,
        connectionId,
        alreadyGranted: true,
        message:
          "A valid write-consent grant already exists. Retry write-local-file.",
      };
    }

    await writeAppState(`design-localhost-write-consent-request:${designId}`, {
      designId,
      connectionId,
      rootPath: connection.rootPath,
      files: files ?? [],
      requestedAt: new Date().toISOString(),
    });

    // The dialog only renders from this design's editor, so only claim it
    // surfaced when the user is actually there. Otherwise the request stays
    // queued and fires when they open the design — report that honestly instead
    // of implying a dialog is on screen.
    const navigation = await readAppStateForCurrentTab("navigation").catch(
      () => null,
    );
    const onThisEditor =
      navigation?.["view"] === "editor" &&
      navigation?.["designId"] === designId;

    if (onThisEditor) {
      return {
        designId,
        connectionId,
        surfaced: true,
        message:
          "Opened the write-consent dialog. Ask the user to click 'Allow " +
          "writes', then retry write-local-file.",
      };
    }

    return {
      designId,
      connectionId,
      surfaced: false,
      message:
        "Queued a write-consent request, but the user is not on this design's " +
        "editor so no dialog is showing yet. Ask them to open the design; the " +
        "prompt appears then, and you can retry write-local-file after they approve.",
    };
  },
});
