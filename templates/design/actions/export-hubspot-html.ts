import { defineAction, fail } from "@agent-native/core/action";
import { resolveAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { exportFilename } from "../server/lib/design-export.js";
import { exportHubSpotEmailHtml } from "../server/lib/hubspot-email-export.js";
import { sourceContentHash } from "../shared/source-workspace.js";

export default defineAction({
  description:
    "Validate and export any HTML frame as HubSpot email HTML with inline styles, preserved responsive CSS and HubL tokens, and validated public images. Returns html, filename, and imageCount; fails on unsupported browser content, hidden/missing email requirements, or contact personalization filters (use personalization_token with a literal default and no filters). Use preserveLinksFromFileId to check that a converted frame retains its original business link destinations. Read hubspot-email for the complete authoring and handoff workflow. This action validates HTML and images only; it does not establish semantic review, HubSpot compilation, or inbox rendering.",
  schema: z.object({
    id: z.string().describe("Design ID containing the HTML frame"),
    fileId: z
      .string()
      .describe(
        "File ID of any HTML frame to validate and export; no special frame type is required",
      ),
    preserveLinksFromFileId: z
      .string()
      .optional()
      .describe(
        "Optional original content frame ID in this same design, distinct from fileId. Rejects export when approved source anchor destinations are missing or rewritten, including literal contact URL defaults. Use when converting a frame while retaining its business links; this does not verify link labels or media semantics.",
      ),
    expectedVersionHash: z
      .string()
      .optional()
      .describe(
        "Optional sourceContentHash of the editor's current frame HTML; rejects an unsaved or concurrently changed source with HTTP 409",
      ),
  }),
  readOnly: true,
  dedupe: false,
  run: async ({ id, fileId, expectedVersionHash, preserveLinksFromFileId }) => {
    const access = await resolveAccess("design", id);
    if (!access)
      fail("Design not found or inaccessible.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    const [file] = await getDb()
      .select()
      .from(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.designId, id),
          eq(schema.designFiles.id, fileId),
        ),
      )
      .limit(1);
    if (!file || file.fileType !== "html" || !file.content)
      fail("The selected HTML frame was not found in this design.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    if (
      expectedVersionHash !== undefined &&
      expectedVersionHash !== sourceContentHash(file.content)
    )
      fail(
        "Save your changes before exporting; this frame has unsaved or concurrent changes.",
        { errorCode: "hubspot_email_source_changed", statusCode: 409 },
      );
    let sourceHtml: string | undefined;
    if (preserveLinksFromFileId !== undefined) {
      if (preserveLinksFromFileId === fileId)
        fail(
          "Choose the distinct original content frame for link preservation, not the exported frame itself.",
          {
            errorCode: "invalid_hubspot_email",
            statusCode: 422,
          },
        );
      const [source] = await getDb()
        .select()
        .from(schema.designFiles)
        .where(
          and(
            eq(schema.designFiles.designId, id),
            eq(schema.designFiles.id, preserveLinksFromFileId),
          ),
        )
        .limit(1);
      if (!source || source.fileType !== "html" || !source.content)
        fail(
          "The original HTML content frame for link preservation was not found in this design.",
          {
            errorCode: "not_found",
            statusCode: 404,
          },
        );
      sourceHtml = source.content;
    }
    const result =
      sourceHtml === undefined
        ? await exportHubSpotEmailHtml(file.content)
        : await exportHubSpotEmailHtml(file.content, {
            preserveLinksFromHtml: sourceHtml,
          });
    return {
      ...result,
      filename: exportFilename(
        file.filename.replace(/\.html?$/i, "") + "-hubspot",
        "html",
      ),
    };
  },
});
