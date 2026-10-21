import { createGetDb } from "@agent-native/core/db";
import { registerIdentityColumns } from "@agent-native/core/org";
import { registerShareableResource } from "@agent-native/core/sharing";

import {
  DECK_AGENT_CONTEXT_ENDPOINT,
  DECK_AGENT_RESOURCE_KIND,
} from "../../shared/agent-readable.js";
import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

registerIdentityColumns([
  {
    table: "uploaded_asset_cleanup_outbox",
    column: "owner_email",
    emailChange: "rekey",
    offboard: "retain",
    reason:
      "Pending provider cleanup follows an email change and remains durable for storage deletion after offboarding.",
  },
  {
    table: "slide_comments",
    column: "author_email",
    emailChange: "rekey",
    offboard: "retain",
    orgScope: {
      column: "deck_id",
      references: { table: "decks", column: "id", orgColumn: "org_id" },
    },
    reason:
      "Rekeying preserves comment ownership and notifications after an email change; comments remain as deck history when a member leaves.",
  },
  {
    table: "deck_events",
    column: "created_by",
    emailChange: "retain",
    offboard: "retain",
    orgScope: {
      column: "deck_id",
      references: { table: "decks", column: "id", orgColumn: "org_id" },
    },
    reason:
      "Deck event actors are historical attribution and remain recorded when their email or membership changes.",
  },
]);

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
