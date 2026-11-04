import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

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
  // Every org admin uploads to the one shared Company Context intake source,
  // not only the admin who created it. Scoped to that source so admins gain
  // nothing over other members' private sources.
  canManageAccess: async (source, ctx) => {
    const { isCompanyContextIntakeConfig } = await import("../lib/brain.js");
    if (!isCompanyContextIntakeConfig(source.configJson)) return false;
    const { isBrainAdmin } = await import("../lib/zoom-governance.js");
    return isBrainAdmin(ctx.userEmail, source.orgId);
  },
  getDb,
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
