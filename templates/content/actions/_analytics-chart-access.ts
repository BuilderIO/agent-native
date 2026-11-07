import { fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import type { EmbedVisibility } from "@agent-native/core/shared";
import { roleSatisfies } from "@agent-native/core/sharing";
import { z } from "zod";

import { isPublicViewerOwner } from "../server/lib/public-documents.js";
import { resolveDocumentAccess } from "./_document-access.js";

export const analyticsChartDocumentIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .describe("Page id");

/**
 * The page a chart goes in, for a signed-in reader (`viewer`) or one of its
 * editors (`editor`). A page in Trash, or one the caller can't open, reads as
 * missing either way.
 */
export async function authorizeAnalyticsChartPage(
  documentId: string,
  role: "viewer" | "editor",
): Promise<{ visibility: EmbedVisibility }> {
  const email = getRequestUserEmail();
  if (!email || isPublicViewerOwner(email)) {
    fail("Sign in to use Analytics charts.", {
      errorCode: "analytics_chart_signed_out",
      statusCode: 401,
    });
  }
  const access = await resolveDocumentAccess(documentId, {
    skipResourceBody: true,
  });
  if (!access || access.resource.trashedAt) {
    fail("Page not found", {
      errorCode: "document_not_found",
      statusCode: 404,
    });
  }
  if (!roleSatisfies(access.role, role)) {
    fail("Only the page's editors can add or refresh its Analytics charts.", {
      errorCode: "analytics_chart_edit_required",
      statusCode: 403,
    });
  }
  const stored = access.resource.visibility;
  const visibility =
    stored === "org" || stored === "public" ? stored : "private";
  return { visibility };
}
