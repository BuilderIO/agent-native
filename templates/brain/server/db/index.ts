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

// Access to the shared Company Context intake source follows current org admin
// status, not ownership or shares: every current admin gets editor, other org
// members get read-only (so a share cannot let a non-admin upload), and the
// creating admin loses access once demoted. ensure-company-context-source
// restores the source if it is archived or made private. Every other source
// falls through to the normal sharing rules.
registerHostAccessResolver("brain-source", async (source, ctx) => {
  const { companyContextSourceId, isCompanyContextIntakeConfig } =
    await import("../lib/brain.js");
  if (!source?.orgId || source.id !== companyContextSourceId(source.orgId)) {
    return undefined;
  }
  // Status-only loads omit configJson; create-source reserves the id prefix.
  if (
    source.configJson !== undefined &&
    !isCompanyContextIntakeConfig(source.configJson)
  ) {
    return undefined;
  }
  const { isBrainAdmin } = await import("../lib/zoom-governance.js");
  if (await isBrainAdmin(ctx.userEmail, source.orgId)) return "editor";
  const email = ctx.userEmail?.trim().toLowerCase();
  if (!email || source.ownerEmail?.toLowerCase() === email) return null;
  if (source.visibility !== "org") return null;
  const { readOrgMemberRole } = await import("@agent-native/core/server");
  return (await readOrgMemberRole(source.orgId, email)) ? "viewer" : null;
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
