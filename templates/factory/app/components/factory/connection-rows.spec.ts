import { describe, expect, it } from "vitest";

import { OPERATION_CATALOG } from "../../../server/workflow/catalog/index.js";
import {
  STORY_GRAPHS,
  buildGraph,
  fixed,
} from "../../../server/workflow/story-graphs.fixture.js";
import {
  connectionRows,
  connectTarget,
  emailReadiness,
  missingConnections,
  providersUsedByGraph,
  providersUsedByGraphs,
  unconnectedByNode,
  type ProviderConnection,
} from "./connection-rows";

const every5 = { schedule: { every: "5m" } };

describe("providersUsedByGraph", () => {
  it("names the poller, the operations and the Builder call a workflow makes", () => {
    const providers = providersUsedByGraph(
      STORY_GRAPHS["bug-report-to-builder"],
      OPERATION_CATALOG,
    );
    expect(providers).toEqual(expect.arrayContaining(["slack", "builder"]));
  });

  it("reads each kind of node that can reach a provider", () => {
    const graph = buildGraph({
      nodes: [
        ["every", "trigger", every5],
        [
          "poll",
          "source",
          { source: "inbox-poll", poller: "sentry", takeLimit: 5 },
        ],
        [
          "leads",
          "source",
          {
            source: "provider-query",
            operation: "hubspot.newLeads",
            args: {},
            memory: "inbox",
          },
        ],
        [
          "post",
          "action",
          {
            operation: "slack.postMessage",
            args: { to: fixed("C1"), text: fixed("hi") },
          },
        ],
        ["done", "end", { outcome: "done" }],
      ],
      edges: [
        ["every", "out", "poll"],
        ["poll", "out", "leads"],
        ["leads", "out", "post"],
        ["post", "out", "done"],
      ],
    });
    expect(providersUsedByGraph(graph, OPERATION_CATALOG).sort()).toEqual([
      "hubspot",
      "sentry",
      "slack",
    ]);
  });

  it("leaves out Factory's own operations, which need no connection", () => {
    const graph = buildGraph({
      nodes: [
        ["every", "trigger", every5],
        [
          "waiting",
          "source",
          {
            source: "provider-query",
            operation: "factory.listItems",
            args: {},
            memory: "none",
          },
        ],
        ["done", "end", { outcome: "done" }],
      ],
      edges: [
        ["every", "out", "waiting"],
        ["waiting", "out", "done"],
      ],
    });
    expect(providersUsedByGraph(graph, OPERATION_CATALOG)).toEqual([]);
  });

  it("returns each provider once across several workflows, sorted", () => {
    const providers = providersUsedByGraphs(
      Object.values(STORY_GRAPHS),
      OPERATION_CATALOG,
    );
    expect(new Set(providers).size).toBe(providers.length);
    expect(providers).toEqual([...providers].sort());
    expect(providers).not.toContain("factory");
  });
});

describe("connectionRows", () => {
  const reported: ProviderConnection[] = [
    {
      provider: "slack",
      status: "connected",
      connectWith: "workspace-connection",
    },
    {
      provider: "hubspot",
      status: "not connected",
      connectWith: "workspace-connection",
      detail: "Connect it in Dispatch or add its key to the vault.",
    },
    {
      provider: "gong",
      status: "unknown",
      connectWith: "vault",
      detail: "The vault could not be read.",
    },
  ];

  it("shows connected providers as ready", () => {
    expect(connectionRows(["slack"], reported)).toEqual([
      {
        provider: "slack",
        readiness: "ready",
        word: "connected",
        connectWith: "workspace-connection",
      },
    ]);
  });

  it("shows a missing connection as not connected, with where it is made", () => {
    expect(connectionRows(["hubspot"], reported)[0]).toMatchObject({
      readiness: "needs_credentials",
      word: "notConnected",
      detail: "Connect it in Dispatch or add its key to the vault.",
      connectWith: "workspace-connection",
    });
  });

  it("keeps a failed check apart from a missing connection", () => {
    expect(connectionRows(["gong"], reported)[0]).toMatchObject({
      readiness: "needs_attention",
      word: "couldNotCheck",
      connectWith: "vault",
    });
  });

  it("never reads a provider the check skipped as connected", () => {
    expect(connectionRows(["pylon"], reported)[0]).toMatchObject({
      readiness: "needs_attention",
      word: "couldNotCheck",
    });
  });

  it("keeps the order of the providers it was given", () => {
    expect(
      connectionRows(["gong", "slack"], reported).map((row) => row.provider),
    ).toEqual(["gong", "slack"]);
  });
});

describe("connectTarget", () => {
  const workspace = { workspace: true, signIn: true };
  const alone = { workspace: false, signIn: true };

  it("sends a provider in the workspace connection catalog to Dispatch's Integrations page", () => {
    for (const provider of [
      "bigquery",
      "github",
      "hubspot",
      "jira",
      "notion",
      "sentry",
      "slack",
    ]) {
      expect(
        connectTarget(provider, "workspace-connection", workspace),
      ).toEqual({ kind: "dispatch", page: "integrations" });
    }
  });

  it("sends a key for a provider outside the catalog to Dispatch's API keys page", () => {
    for (const provider of ["gong", "posthog", "pylon", "stripe"]) {
      expect(connectTarget(provider, "vault", workspace)).toEqual({
        kind: "dispatch",
        page: "api-keys",
      });
    }
  });

  it("never starts a sign-in in a workspace, even for a provider that could not be checked", () => {
    expect(
      connectTarget("github", "workspace-connection", {
        workspace: true,
        signIn: false,
      }),
    ).toEqual({ kind: "dispatch", page: "integrations" });
  });

  it("keeps Builder and email with this app's Settings, in a workspace or not", () => {
    for (const where of [workspace, alone]) {
      expect(connectTarget("builder", "settings", where)).toEqual({
        kind: "settings",
        page: "integrations",
        sub: "builder",
      });
      expect(connectTarget("email", "settings", where)).toEqual({
        kind: "settings",
        page: "api-keys",
      });
    }
  });

  it("signs in with the shared popup for a catalog provider with OAuth, outside a workspace", () => {
    for (const provider of ["github", "sentry", "hubspot", "jira", "notion"]) {
      expect(connectTarget(provider, "workspace-connection", alone)).toEqual({
        kind: "oauth",
        provider,
      });
    }
  });

  it("keeps a key, or a provider that could not be checked, in this app's API keys outside a workspace", () => {
    expect(connectTarget("gong", "vault", alone)).toEqual({
      kind: "settings",
      page: "api-keys",
    });
    expect(connectTarget("slack", "workspace-connection", alone)).toEqual({
      kind: "settings",
      page: "api-keys",
    });
    expect(
      connectTarget("github", "workspace-connection", {
        workspace: false,
        signIn: false,
      }),
    ).toEqual({ kind: "settings", page: "api-keys" });
  });
});

describe("missingConnections", () => {
  const reported: ProviderConnection[] = [
    {
      provider: "slack",
      status: "connected",
      connectWith: "workspace-connection",
    },
    {
      provider: "hubspot",
      status: "not connected",
      connectWith: "workspace-connection",
      detail: "Connect it in Dispatch.",
    },
    { provider: "gong", status: "unknown", connectWith: "vault" },
  ];
  const graph = buildGraph({
    nodes: [
      ["every", "trigger", every5],
      [
        "leads",
        "source",
        {
          source: "provider-query",
          operation: "hubspot.newLeads",
          args: {},
          memory: "inbox",
        },
      ],
      [
        "post",
        "action",
        {
          operation: "slack.postMessage",
          args: { to: fixed("C1"), text: fixed("hi") },
        },
      ],
      ["done", "end", { outcome: "done" }],
    ],
    edges: [
      ["every", "out", "leads"],
      ["leads", "out", "post"],
      ["post", "out", "done"],
    ],
  });

  it("lists only the providers known to be missing, with the steps that use them", () => {
    expect(missingConnections(graph, OPERATION_CATALOG, reported)).toEqual([
      {
        provider: "hubspot",
        connectWith: "workspace-connection",
        detail: "Connect it in Dispatch.",
        nodeIds: ["leads"],
      },
    ]);
  });

  it("lists nothing for a provider that could not be checked or was not reported", () => {
    expect(missingConnections(graph, OPERATION_CATALOG, [reported[2]])).toEqual(
      [],
    );
    expect(missingConnections(graph, OPERATION_CATALOG, undefined)).toEqual([]);
  });

  it("names the providers each step waits on", () => {
    expect(
      unconnectedByNode([
        { provider: "hubspot", connectWith: null, nodeIds: ["a", "b"] },
        { provider: "slack", connectWith: null, nodeIds: ["b"] },
      ]),
    ).toEqual({ a: ["hubspot"], b: ["hubspot", "slack"] });
  });
});

describe("emailReadiness", () => {
  it("tells a missing provider from a broken one from an unreadable one", () => {
    expect(emailReadiness("ready").word).toBe("connected");
    expect(emailReadiness("not-configured").word).toBe("notConnected");
    expect(emailReadiness("misconfigured").word).toBe("needsAttention");
    expect(emailReadiness("unavailable").word).toBe("couldNotCheck");
  });
});
