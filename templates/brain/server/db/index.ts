import { createGetDb } from "@agent-native/core/db";
import {
  registerHostAccessResolver,
  registerShareableResource,
} from "@agent-native/core/sharing";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "brain-source",
  agentRead: { actions: ["get-source"] },
  resourceTable: schema.brainSources,
  sharesTable: schema.brainSourceShares,
  displayName: "Brain Source",
  titleColumn: "title",
  getResourcePath: (source) => `/sources/${source.id}`,
  allowPublic: false,
  requireOrgMemberForUserShares: true,
  getDb,
});

// Every org admin uploads to the one shared Company Context intake source, not
// only the admin who created it. Editor only (no sharing/visibility control),
// and every other source falls through to the normal sharing rules.
registerHostAccessResolver("brain-source", async (source, ctx) => {
  // Match on the reserved id alone: some core paths load only id/owner/org/
  // visibility, and create-source refuses ids with this prefix.
  const { companyContextSourceId } = await import("../lib/brain.js");
  if (!source?.orgId || source.id !== companyContextSourceId(source.orgId)) {
    return undefined;
  }
  const { isBrainAdmin } = await import("../lib/zoom-governance.js");
  return (await isBrainAdmin(ctx.userEmail, source.orgId))
    ? "editor"
    : undefined;
});

registerShareableResource({
  type: "brain-knowledge",
  resourceTable: schema.brainKnowledge,
  sharesTable: schema.brainKnowledgeShares,
  displayName: "Brain Knowledge",
  titleColumn: "title",
  getResourcePath: (knowledge) => `/knowledge/${knowledge.id}`,
  allowPublic: false,
  requireOrgMemberForUserShares: true,
  getDb,
});

registerShareableResource({
  type: "brain-proposal",
  resourceTable: schema.brainProposals,
  sharesTable: schema.brainProposalShares,
  displayName: "Brain Proposal",
  titleColumn: "title",
  getResourcePath: (proposal) => `/proposals/${proposal.id}`,
  allowPublic: false,
  requireOrgMemberForUserShares: true,
  getDb,
});

registerShareableResource({
  type: "brain-project",
  resourceTable: schema.brainProjects,
  sharesTable: schema.brainProjectShares,
  displayName: "Brain Project",
  titleColumn: "title",
  getResourcePath: (project) => `/search?projectId=${project.id}`,
  allowPublic: false,
  requireOrgMemberForUserShares: true,
  getDb,
});
