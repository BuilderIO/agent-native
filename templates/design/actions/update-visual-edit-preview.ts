import {
  defineAction,
  fail,
  isOutsideAgentCall,
} from "@agent-native/core/action";
import { isBlockedExtensionUrlWithDns } from "@agent-native/core/extensions/url-safety";
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
    "Set or remove a public HTTPS preview URL (for example an ngrok or cloudflared tunnel) for a localhost screen's shared live preview. Any public HTTPS origin the editor chooses is accepted if its hostname resolves to public addresses. Enabling design-wide live collaboration requires the explicit enableLiveCollaboration input. Signed-in editors only.",
  requiresAuth: true,
  mcpAnnotations: {
    readOnlyHint: false,
    // Replaces or clears the screen's existing public preview mapping.
    destructiveHint: true,
    openWorldHint: false,
  },
  schema: z.object({
    designId: z.string().min(1).describe("Design project ID."),
    fileId: z.string().min(1).describe("Localhost screen ID."),
    tunnelUrl: z
      .string()
      .nullable()
      .describe(
        "Public HTTPS preview base URL, such as an ngrok or cloudflared tunnel, or null to use the published snapshot.",
      ),
    enableLiveCollaboration: z
      .boolean()
      .default(false)
      .describe(
        "Explicitly enable design-wide live collaboration while saving this preview URL.",
      ),
  }),
  outputSchema: z.object({
    designId: z.string(),
    fileId: z.string(),
    tunnelUrl: z.string().nullable(),
    sharePath: z.string(),
    liveCollaborationEnabled: z.boolean(),
  }),
  needsApproval: (_args, ctx) => isOutsideAgentCall(ctx),
  mcpTool: "search",
  run: async ({ designId, fileId, tunnelUrl, enableLiveCollaboration }) => {
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
      fail("The public preview URL must use a different origin from Design.", {
        statusCode: 400,
        errorCode: "invalid_tunnel_origin",
      });
    if (normalized && (await isBlockedExtensionUrlWithDns(normalized)))
      fail("The public preview URL must resolve to a public address.", {
        statusCode: 400,
        errorCode: "private_tunnel_address",
      });
    let liveCollaborationEnabledResult = false;
    await withDesignSourceMutationTransaction(designId, async (tx) => {
      await assertVisualEditAccountEditor(designId);
      const design = (
        await tx
          .select({
            data: schema.designs.data,
            liveCollaborationEnabled: schema.designs.liveCollaborationEnabled,
          })
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
          ...(enableLiveCollaboration
            ? { liveCollaborationEnabled: true }
            : {}),
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
      liveCollaborationEnabledResult =
        design.liveCollaborationEnabled || enableLiveCollaboration;
    });
    return {
      designId,
      fileId,
      tunnelUrl: normalized,
      sharePath: `/visual-edit/${encodeURIComponent(designId)}?share=1`,
      liveCollaborationEnabled: liveCollaborationEnabledResult,
    };
  },
});
