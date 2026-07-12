import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "brain-source",
  resourceTable: schema.brainSources,
  sharesTable: schema.brainSourceShares,
  displayName: "Brain Source",
  titleColumn: "title",
  getResourcePath: (source) => `/sources/${source.id}`,
  getDb,
});

registerShareableResource({
  type: "brain-knowledge",
  resourceTable: schema.brainKnowledge,
  sharesTable: schema.brainKnowledgeShares,
  displayName: "Brain Knowledge",
  titleColumn: "title",
  getResourcePath: (knowledge) => `/knowledge/${knowledge.id}`,
  getDb,
});

registerShareableResource({
  type: "brain-proposal",
  resourceTable: schema.brainProposals,
  sharesTable: schema.brainProposalShares,
  displayName: "Brain Proposal",
  titleColumn: "title",
  getResourcePath: (proposal) => `/proposals/${proposal.id}`,
  getDb,
});
