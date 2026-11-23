import { expect, it } from "vitest";

import {
  type ActionSuggestion,
  type ActionSuggestionReceipt,
  parseActionSuggestion,
} from "./index.js";

const suggestion = {
  id: "human-notifications",
  kind: "filter",
  trigger: "ai-narrowing",
  label: "Save human notifications",
  rationale: "Find replies from people in one view.",
  appId: "workspace/mail",
  execution: {
    type: "action",
    action: "create-split",
    params: { criteria: { senderType: "human" } },
  },
} satisfies ActionSuggestion;

it("round-trips suggested actions, new apps, and accepted receipts", () => {
  const createApp = {
    id: "equipment-checkouts",
    kind: "create-app",
    trigger: "new-domain",
    label: "Build equipment checkouts",
    rationale: "Keep track of equipment and due dates.",
    appId: "dispatch",
    execution: {
      type: "create-app",
      domainSpec: "Track equipment, borrowers, and due dates.",
    },
  } satisfies ActionSuggestion;
  const receipt = {
    suggestionId: suggestion.id,
    status: "accepted",
    outcome: "action-completed",
  } satisfies ActionSuggestionReceipt;
  const wire = JSON.parse(
    JSON.stringify({ suggestions: [suggestion, createApp], receipt }),
  );
  expect(
    wire.suggestions.map((item: unknown) => parseActionSuggestion(item)),
  ).toEqual([suggestion, createApp]);
  expect(wire.receipt).toEqual(receipt);
});

it("rejects incompatible execution and a different customization target", () => {
  expect(() =>
    parseActionSuggestion({ ...suggestion, kind: "create-app" }),
  ).toThrow(/execution.type/);
  expect(() =>
    parseActionSuggestion({
      ...suggestion,
      kind: "customize-app",
      execution: {
        type: "customize",
        targetAppId: "another-workspace/mail",
        editSpec: "Add a filter",
      },
    }),
  ).toThrow(/targetAppId/);
});
