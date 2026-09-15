import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";

import { listContentOrganizationMemberships } from "./_content-space-access.js";

export async function resolveContentDocumentAccess(documentId: string) {
  const current = await resolveAccess("document", documentId);
  if (current) return current;

  const userEmail = getRequestUserEmail();
  if (!userEmail) return null;
  const memberships = await listContentOrganizationMemberships(userEmail);
  for (const membership of memberships) {
    const access = await resolveAccess("document", documentId, {
      userEmail,
      orgId: membership.orgId,
    });
    if (access) return access;
  }
  return null;
}
