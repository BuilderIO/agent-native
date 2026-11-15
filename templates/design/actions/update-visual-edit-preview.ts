import { defineAction, fail } from "@agent-native/core/action";
import { getRequestContext } from "@agent-native/core/server/request-context";
import { accessFilter, currentAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import { assertVisualEditAccountEditor } from "../server/lib/visual-edit-collaboration.js";
import { withDesignSourceMutationTransaction } from "../server/source-workspace.js";
import { designScreenSourceTypeFromData } from "../shared/source-mode.js";
import { normalizeVisualEditTunnelUrl } from "../shared/visual-edit-preview.js";

export default defineAction({
  description:
    "Set or remove a public HTTPS tunnel for a localhost screen's shared live preview. Signed-in editors only; sharing permissions remain unchanged.",
  requiresAuth: true,
  schema: z.object({
    designId: z.string().min(1).describe("Design project ID."),
    fileId: z.string().min(1).describe("Localhost screen ID."),
    tunnelUrl: z
      .string()
      .nullable()
      .describe(
        "Public HTTPS ngrok/cloudflared base URL, or null to use the published snapshot.",
      ),
  }),
  outputSchema: z.object({
    designId: z.string(),
    fileId: z.string(),
    tunnelUrl: z.string().nullable(),
    sharePath: z.string(),
  }),
  run: async ({ designId, fileId, tunnelUrl }) => {
    await assertVisualEditAccountEditor(designId);
    const accessContext = { ...currentAccess() };
    delete accessContext.authCapability;
    const normalized =
      tunnelUrl === null ? null : normalizeVisualEditTunnelUrl(tunnelUrl);
    const designOrigin =
      getRequestContext()?.requestOrigin ?? "https://design.agent-native.com";
    if (
      normalized &&
      new URL(normalized).origin === new URL(designOrigin).origin
    )
      fail("The tunnel must use a different origin from Design.", {
        statusCode: 400,
        errorCode: "invalid_tunnel_origin",
      });
    await withDesignSourceMutationTransaction(designId, async (tx) => {
      await assertVisualEditAccountEditor(designId);
      const design = (
        await tx
          .select({ data: schema.designs.data })
          .from(schema.designs)
          .where(
            and(
              eq(schema.designs.id, designId),
              accessFilter(
                schema.designs,
                schema.designShares,
                accessContext,
                "editor",
              ),
            ),
          )
          .for("update")
          .limit(1)
      ).shift();
      if (!design)
        fail("Design not found.", { statusCode: 404, errorCode: "not_found" });
      const data = JSON.parse(design.data) as Record<string, unknown>;
      if (designScreenSourceTypeFromData(data, fileId) !== "localhost")
        fail("Choose a localhost screen.", {
          statusCode: 400,
          errorCode: "not_localhost_screen",
        });
      const metadata = data.screenMetadata as
        | Record<string, Record<string, unknown>>
        | undefined;
      const legacy = data.localhostScreens as
        | Record<string, Record<string, unknown>>
        | undefined;
      const screen = metadata?.[fileId] ?? legacy?.[fileId];
      if (!screen)
        fail("Screen metadata is missing.", {
          statusCode: 404,
          errorCode: "screen_not_found",
        });
      data.screenMetadata = {
        ...metadata,
        [fileId]: { ...screen, tunnelUrl: normalized },
      };
      const updated = await tx
        .update(schema.designs)
        .set({
          data: JSON.stringify(data),
          ...(normalized ? { liveCollaborationEnabled: true } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.designs.id, designId),
            accessFilter(
              schema.designs,
              schema.designShares,
              accessContext,
              "editor",
            ),
          ),
        )
        .returning({ id: schema.designs.id });
      if (updated.length !== 1)
        fail("The preview mapping was not saved.", {
          statusCode: 409,
          errorCode: "preview_mapping_conflict",
        });
    });
    return {
      designId,
      fileId,
      tunnelUrl: normalized,
      sharePath: `/visual-edit/${encodeURIComponent(designId)}?share=1`,
    };
  },
});
