import { fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import type { EmbedVisibility } from "@agent-native/core/shared";
import { roleSatisfies } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  sharesAudience,
  widerAudience,
} from "../server/lib/analytics-chart-sharing.js";
import { isPublicViewerOwner } from "../server/lib/public-documents.js";
import { resolveDocumentAccess } from "./_document-access.js";

export const embedDocumentIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .describe("Page id");

/** A page a copy from another app goes in, as an embed action sees it. */
export interface EmbedPage {
  /** Who can open the page, counting its shares. */
  visibility: EmbedVisibility;
  orgId: string | null;
  /**
   * The organization that let the caller open it: their current one, or
   * for a page in a space, the space's.
   */
  authorityOrgId: string | null;
}

/** What a refusal says, for each embed kind. */
export interface EmbedPageRefusals {
  signedOut: { message: string; errorCode: string };
  editRequired: { message: string; errorCode: string };
}

/** Who a page's shares reach; see `sharesAudience`. */
async function pageSharesAudience(
  documentId: string,
  orgId: string | null,
): Promise<EmbedVisibility> {
  const shares = await getDb()
    .select({
      principalType: schema.documentShares.principalType,
      principalId: schema.documentShares.principalId,
    })
    .from(schema.documentShares)
    .where(eq(schema.documentShares.resourceId, documentId));
  return sharesAudience(orgId, shares);
}

/**
 * The page a copy goes in, for a signed-in reader (`viewer`) or one of its
 * editors (`editor`). A page in Trash, or one the caller can't open, reads as
 * missing either way. Its audience counts its shares too: one with a
 * colleague opens it to the organization, one with anyone outside it to
 * everyone.
 */
export async function authorizeEmbedPage(
  documentId: string,
  role: "viewer" | "editor",
  refusals: EmbedPageRefusals,
): Promise<EmbedPage> {
  const email = getRequestUserEmail();
  if (!email || isPublicViewerOwner(email)) {
    fail(refusals.signedOut.message, {
      errorCode: refusals.signedOut.errorCode,
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
    fail(refusals.editRequired.message, {
      errorCode: refusals.editRequired.errorCode,
      statusCode: 403,
    });
  }
  const { orgId } = access.resource;
  const authorityOrgId = access.authority.orgId;
  const stored = access.resource.visibility;
  if (stored === "public") return { visibility: stored, orgId, authorityOrgId };
  const shared = await pageSharesAudience(documentId, orgId);
  return {
    visibility: widerAudience(stored === "org" ? "org" : "private", shared),
    orgId,
    authorityOrgId,
  };
}

/**
 * The other app reports its resource's sharing for the organization that
 * opened the page. A resource shared with that organization reaches none of
 * the readers of a page from another one, such as the editor's own page
 * from an organization they've since left, so there it counts as private.
 */
export function visibilityForPageOrganization(
  visibility: EmbedVisibility,
  page: Pick<EmbedPage, "orgId" | "authorityOrgId">,
): EmbedVisibility {
  return page.orgId &&
    page.orgId !== page.authorityOrgId &&
    visibility === "org"
    ? "private"
    : visibility;
}
