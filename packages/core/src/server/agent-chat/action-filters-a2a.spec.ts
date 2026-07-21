import { describe, expect, it, vi } from "vitest";

import type { ActionEntry } from "../../agent/production-agent.js";
import { filterDirectA2AActions } from "./action-filters-a2a.js";

function action(overrides: Partial<ActionEntry> = {}): ActionEntry {
  return {
    tool: { description: "Read", parameters: { type: "object" } },
    run: vi.fn(),
    http: { method: "GET" },
    readOnly: true,
    publicAgent: {
      expose: true,
      readOnly: true,
      requiresAuth: true,
      isConsequential: false,
    },
    ...overrides,
  };
}

describe("filterDirectA2AActions", () => {
  it("allows only cataloged authenticated reads", () => {
    const actions = {
      allowed: action(),
      uncataloged: action(),
      mutation: action({ readOnly: false }),
      hidden: action({ agentTool: false }),
      approval: action({ needsApproval: true }),
      public: action({
        publicAgent: {
          expose: true,
          readOnly: true,
          requiresAuth: false,
        },
      }),
    };

    expect(
      Object.keys(
        filterDirectA2AActions(actions, {
          connectorCatalog: [
            "allowed",
            "mutation",
            "hidden",
            "approval",
            "public",
          ],
        }),
      ),
    ).toEqual(["allowed"]);
  });

  it("supports authenticated-read auto exposure while honoring denyActions", () => {
    const result = filterDirectA2AActions(
      {
        allowed: action(),
        denied: action(),
        post: action({ http: { method: "POST" } }),
        "db-query": action(),
        "seed-demo": action(),
        "list-extensions": action(),
        "list-browser-sessions": action(),
      },
      {
        externalAgents: {
          authenticatedReads: "auto",
          denyActions: ["denied"],
        },
      },
    );

    expect(Object.keys(result)).toEqual(["allowed"]);
  });
});
