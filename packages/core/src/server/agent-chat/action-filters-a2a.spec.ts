import { describe, expect, it, vi } from "vitest";

import type { ActionEntry } from "../../agent/production-agent.js";
import { CORE_ACTION_GROUPS } from "../../framework-tools.js";
import {
  buildAuthenticatedAgentA2ASkills,
  buildPublicAgentA2ASkills,
  filterDirectA2AActions,
  resolveInitialToolNames,
} from "./action-filters-a2a.js";

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
  it("publishes input schemas for public and authenticated skill cards", () => {
    const inputSchema = {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
    };

    const publicSkills = buildPublicAgentA2ASkills({
      public: action({
        tool: { description: "Ask", parameters: inputSchema },
        publicAgent: {
          expose: true,
          readOnly: true,
          requiresAuth: false,
        },
      }),
    });
    const authenticatedSkills = buildAuthenticatedAgentA2ASkills(
      {
        authenticated: action({
          tool: { description: "Ask", parameters: inputSchema },
        }),
      },
      { connectorCatalog: ["authenticated"] },
    );

    expect(publicSkills[0]?.inputSchema).toEqual(inputSchema);
    // Everything in the authenticated set is read-only by construction. Without
    // the flag, discovery renders each one "(mutating)" and callers back off to
    // open-ended delegation instead of invoking them.
    expect(authenticatedSkills[0]?.readOnly).toBe(true);
    expect(authenticatedSkills[0]?.inputSchema).toEqual(inputSchema);
  });

  // The app that owns the data owns its schema, dictionary and reference
  // queries. A caller has none of that, so passing raw SQL across apps makes
  // every caller reimplement the owner's schema badly. Callers ask; the owner
  // forms the query.
  it("never exposes a raw query or code input to a sibling app", () => {
    const rawInput = (field: string) =>
      action({
        tool: {
          description: "Run it",
          parameters: {
            type: "object",
            properties: { [field]: { type: "string" } },
            required: [field],
          },
        },
      });
    const actions = {
      "raw-sql": rawInput("sql"),
      "raw-code": rawInput("code"),
      "raw-script": rawInput("script"),
      "raw-expression": rawInput("expression"),
      "raw-optional-sql": action({
        tool: {
          description: "Run optional SQL",
          parameters: {
            type: "object",
            properties: { sql: { type: ["string", "null"] } },
          },
        },
      }),
      // `query` is search text in every template that takes it (Brain's
      // search-everything/search-knowledge), not a query language. Blocking it
      // would break the ask-don't-instruct calls this rule encourages.
      "search-text": rawInput("query"),
      semantic: action({
        tool: {
          description: "Metrics",
          parameters: {
            type: "object",
            properties: { days: { type: "number" } },
          },
        },
      }),
    };

    expect(
      Object.keys(
        filterDirectA2AActions(actions, {
          connectorCatalog: Object.keys(actions),
        }),
      ).sort(),
    ).toEqual(["search-text", "semantic"]);
  });

  it("allows a raw query input only with an explicit opt-in", () => {
    const actions = {
      "raw-sql": action({
        tool: {
          description: "Run SQL",
          parameters: {
            type: "object",
            properties: { sql: { type: "string" } },
            required: ["sql"],
          },
        },
        publicAgent: {
          expose: true,
          readOnly: true,
          requiresAuth: true,
          allowRawQueryInput: true,
        },
      }),
    };

    expect(
      Object.keys(
        filterDirectA2AActions(actions, { connectorCatalog: ["raw-sql"] }),
      ),
    ).toEqual(["raw-sql"]);
  });

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

describe("resolveInitialToolNames", () => {
  it("keeps core framework kits out of the default first-request list", () => {
    // Guard for the untagged path: `frameworkGroup` is stamped only by
    // `mergeCoreSharingActions`, which runs against the ungated `httpActions`,
    // so apps loading core kits from a generated registry or their own actions
    // directory hold untagged entries — and were promoting ~45 framework
    // schemas into every first request. Build the fixture the way those apps
    // do, with no tag, so a regression fails here.
    const untagged = Object.fromEntries(
      Object.keys(CORE_ACTION_GROUPS).map((name) => [name, action()]),
    );

    expect(
      resolveInitialToolNames({ ...untagged, "create-form": action() }),
    ).toEqual(["create-form"]);
  });

  it("does not mistake an app action for a kit it merely resembles", () => {
    expect(resolveInitialToolNames({ "share-portfolio": action() })).toEqual([
      "share-portfolio",
    ]);
  });

  it("returns the configured list verbatim when one is given", () => {
    expect(
      resolveInitialToolNames({ "share-resource": action() }, [
        "share-resource",
      ]),
    ).toEqual(["share-resource"]);
  });
});
