import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import {
  DECK_AGENT_CONTEXT_ENDPOINT,
  DECK_AGENT_RESOURCE_KIND,
} from "../../shared/agent-readable.js";
import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "deck",
  resourceTable: schema.decks,
  sharesTable: schema.deckShares,
  displayName: "Deck",
  titleColumn: "title",
  getResourcePath: (deck) => `/deck/${deck.id}`,
  agentReadable: {
    resourceKind: DECK_AGENT_RESOURCE_KIND,
    getContextPath: () => DECK_AGENT_CONTEXT_ENDPOINT,
    getPagePath: (deck) => `/p/${deck.id}`,
  },
  getDb,
});

registerShareableResource({
  type: "design-system",
  resourceTable: schema.designSystems,
  sharesTable: schema.designSystemShares,
  displayName: "Design System",
  titleColumn: "title",
  getResourcePath: (designSystem) =>
    `/design-systems?designSystemId=${designSystem.id}`,
  getDb,
});
