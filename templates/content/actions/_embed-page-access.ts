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

export interface EmbedPage {
  visibility: EmbedVisibility;
  orgId: string | null;
  authorityOrgId: string | null;
}

export interface EmbedPageRefusals {
  signedOut: { message: string; errorCode: string };
  editRequired: { message: string; errorCode: string };
}

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
