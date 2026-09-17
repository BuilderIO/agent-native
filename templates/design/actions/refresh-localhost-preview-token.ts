import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { resolveLocalhostConnectionScope } from "../server/lib/localhost-connection.js";

export default defineAction({
  description:
    "Refresh the read-only preview token for a localhost Design screen after the local bridge restarts.",
  schema: z.object({
    designId: z.string().describe("Design project ID."),
    connectionId: z.string().describe("Localhost connection ID."),
  }),
  readOnly: true,
  http: { method: "GET" },
  capabilityScopes: ["visual-edit"],
  run: async ({ designId, connectionId }) => {
    await assertAccess("design", designId, "viewer");
    const { ownerEmail, orgId } = await resolveLocalhostConnectionScope({
      designId,
    });
    const [connection] = await getDb()
      .select({
        previewToken: schema.designLocalhostConnections.previewToken,
        bridgeUrl: schema.designLocalhostConnections.bridgeUrl,
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

    if (!connection?.previewToken) {
      throw new Error(
        "The localhost connection has no preview token. Run design connect again, then retry.",
      );
    }

    return {
      previewToken: connection.previewToken,
      bridgeUrl: connection.bridgeUrl,
    };
  },
});
