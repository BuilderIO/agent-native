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
// status, not ownership: every admin gets editor (no sharing/visibility
// control), and the creating admin loses access once demoted. Every other
// source falls through to the normal sharing rules.
registerHostAccessResolver("brain-source", async (source, ctx) => {
  const { companyContextSourceId, isCompanyContextIntakeConfig } =
    await import("../lib/brain.js");
  if (!source?.orgId || source.id !== companyContextSourceId(source.orgId)) {
    return undefined;
  }
  const { isBrainAdmin } = await import("../lib/zoom-governance.js");
  if (await isBrainAdmin(ctx.userEmail, source.orgId)) {
    // Status-only loads omit status/config; create-source reserves the id.
    const intact =
      source.visibility === "org" &&
      source.status !== "archived" &&
      (source.configJson === undefined ||
        isCompanyContextIntakeConfig(source.configJson));
    return intact ? "editor" : undefined;
  }
  const isOwner =
    !!ctx.userEmail &&
    typeof source.ownerEmail === "string" &&
    source.ownerEmail.toLowerCase() === ctx.userEmail.toLowerCase();
  return isOwner ? null : undefined;
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
