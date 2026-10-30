import { describe, expect, it } from "vitest";

import { createEnglishTranslator } from "@/lib/__tests__/en-translator";
import {
  OUT_PORT,
  createWorkflowEditor,
  firstOpenPort,
  workflowGraphSchema,
  type WorkflowCatalog,
  type WorkflowEditor,
} from "@/lib/workflow-editor";

import { OPERATION_CATALOG } from "../../../../server/workflow/catalog/index.js";
import { providerIdentity } from "../provider-identity";
import { createWorkflowCanvasStrings } from "../strings";
import {
  creatorList,
  highlightedRow,
  horizontalKey,
  insertOnEdge,
  moveHighlight,
  selectableRows,
  type CreatorItem,
  type CreatorRow,
  type CreatorTarget,
  type CreatorView,
  type ProviderLinkStatus,
} from "./creator-model";

const strings = createWorkflowCanvasStrings(createEnglishTranslator());
const catalog: WorkflowCatalog = OPERATION_CATALOG;

function list(
  target: CreatorTarget,
  overrides: {
    hasTrigger?: boolean;
    view?: CreatorView;
    query?: string;
    describable?: boolean;
    connections?: Record<string, ProviderLinkStatus>;
  } = {},
) {
  return creatorList({
    catalog,
    target,
    hasTrigger: overrides.hasTrigger ?? false,
    connections: overrides.connections,
    view: overrides.view ?? { kind: "root" },
    query: overrides.query ?? "",
    open: {},
    describable: overrides.describable ?? true,
    strings,
  });
}

function labelsOf(items: CreatorItem[]): string[] {
  return selectableRows(items).map((row) => row.label);
}

function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

function ok<T extends { ok: boolean }>(outcome: T): T & { ok: true } {
  if (!outcome.ok) throw new Error(`expected an edit to succeed`);
  return outcome as T & { ok: true };
}

function openPort(editor: WorkflowEditor, nodeId: string): string {
  const port = firstOpenPort(editor.getSnapshot().graph, nodeId);
  if (port === undefined) throw new Error(`no open output on ${nodeId}`);
  return port;
}

/** trigger -> wait -> filter -> end, plus a loop from the filter back to the wait. */
function sample() {
  const editor = createWorkflowEditor({
    graph: workflowGraphSchema.parse({ nodes: [], edges: [], settings: {} }),
    catalog,
  });
  const trigger = ok(editor.addNode("trigger")).node.id;
  const wait = ok(
    editor.addNode("wait", {
      variant: "time",
      after: { node: trigger, port: OUT_PORT },
    }),
  ).node.id;
  const filter = ok(
    editor.addNode("filter", {
      after: { node: wait, port: openPort(editor, wait) },
    }),
  ).node.id;
  ok(
    editor.addNode("end", {
      after: { node: filter, port: openPort(editor, filter) },
    }),
  );
  const loop = ok(
    editor.connect({ node: filter, port: openPort(editor, filter) }, wait, {
      back: "auto",
    }),
  ).edge.id;
  const graph = editor.getSnapshot().graph;
  const between = (from: string, to: string) => {
    const edge = graph.edges.find(
      (candidate) => candidate.from.node === from && candidate.to.node === to,
    );
    if (!edge) throw new Error(`no edge ${from} -> ${to}`);
    return edge.id;
  };
  return {
    graph,
    trigger,
    wait,
    filter,
    loop,
    forward: between(wait, filter),
  };
}

describe("root lists", () => {
  it("opens the start list on a workflow with no trigger", () => {
    const items = list({ kind: "append" }).items;
    expect(labelsOf(items)).toEqual([
      strings.palette.onSchedule,
      strings.creator.newFromApp,
      strings.palette.itemsInStatus,
      strings.creator.describeIt,
    ]);
  });

  it("opens the next list once the workflow has a trigger", () => {
    const items = list({ kind: "append" }, { hasTrigger: true }).items;
    // oracle-change: the API request step every app has is one row after the apps row, not eleven
    expect(labelsOf(items)).toEqual([
      strings.creator.ai,
      strings.creator.appAction,
      strings.creator.apiRequest,
      strings.creator.data,
      strings.creator.flow,
      strings.creator.describeIt,
    ]);
  });

  it("gives an insertion the next list, never the start list", () => {
    const items = list({ kind: "insert", edgeId: "e" }).items;
    expect(labelsOf(items)).not.toContain(strings.palette.onSchedule);
    expect(labelsOf(items)).toContain(strings.creator.ai);
  });

  it("describes every row on the root lists", () => {
    for (const items of [
      list({ kind: "append" }).items,
      list({ kind: "append" }, { hasTrigger: true }).items,
    ]) {
      const rows = selectableRows(items);
      expect(rows.length).toBeGreaterThan(1);
      expect(
        rows.every(
          (row) => "description" in row && row.description !== undefined,
        ),
      ).toBe(true);
    }
  });

  it("never offers a trigger after a step's output", () => {
    const after = list({
      kind: "append",
      after: { nodeId: "n", port: OUT_PORT },
    }).items;
    expect(labelsOf(after)).not.toContain(strings.palette.onSchedule);
    expect(labelsOf(after)).toContain(strings.creator.newFromApp);
  });
});

describe("apps", () => {
  it("lists the apps that send items, alphabetically, with the Slack inbox", () => {
    const items = list(
      { kind: "append" },
      { view: { kind: "list", list: "sources" } },
    ).items;
    const rows = selectableRows(items);
    expect(rows.every((row) => row.type === "provider")).toBe(true);
    const providers = rows.flatMap((row) =>
      row.type === "provider" ? [row.provider] : [],
    );
    expect(providers).toContain("slack");
    expect(providers).toContain("github");
    expect(providers).not.toContain("builder");
    const names = rows.map((row) => row.label);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("lists the apps with actions, but not an app with only a source", () => {
    const providers = selectableRows(
      list(
        { kind: "append" },
        { hasTrigger: true, view: { kind: "list", list: "actions" } },
      ).items,
    ).flatMap((row) => (row.type === "provider" ? [row.provider] : []));
    expect(providers).toContain("slack");
    expect(providers).toContain("hubspot");
    expect(providers).not.toContain("bigquery");
  });

  it("opens an app's triggers first from the start list, with its actions collapsed", () => {
    const items = list(
      { kind: "append" },
      { view: { kind: "app", provider: "slack", from: "start" } },
    ).items;
    expect(
      items
        .filter((item) => item.type === "group")
        .map((item) => (item.type === "group" ? [item.group, item.open] : [])),
    ).toEqual([
      ["triggers", true],
      ["actions", false],
    ]);
    expect(labelsOf(items)).toEqual([
      strings.creator.triggers,
      strings.palette.watchSlackInbox,
      strings.creator.actions,
    ]);
  });

  it("opens the actions first from the next list, captioned as lookups and actions", () => {
    const items = list(
      { kind: "append" },
      {
        hasTrigger: true,
        view: { kind: "app", provider: "slack", from: "next" },
      },
    ).items;
    expect(items[0]).toMatchObject({
      type: "group",
      group: "actions",
      open: true,
    });
    const captions = items.flatMap((item) =>
      item.type === "caption" ? [item.label] : [],
    );
    // oracle-change: Slack's API request step is pinned after its other rows, under a caption of its own
    expect(captions).toEqual([
      strings.creator.lookUpCaption,
      strings.creator.sendOrChangeCaption,
      strings.creator.anythingElseCaption,
    ]);
    expect(labelsOf(items)).toEqual([
      strings.creator.actions,
      "Find a person by email",
      "Read a thread",
      "Post a message",
      "Reply in a thread",
      "API request",
      strings.creator.triggers,
    ]);
  });

  it("hides a group with no rows, and opens the one that remains", () => {
    const items = list(
      { kind: "append" },
      { view: { kind: "app", provider: "email", from: "start" } },
    ).items;
    const groups = items.flatMap((item) =>
      item.type === "group" ? [{ group: item.group, open: item.open }] : [],
    );
    expect(groups).toEqual([{ group: "actions", open: true }]);
  });

  it("opens both groups for a search, and hides a group with no match", () => {
    const items = list(
      { kind: "append" },
      {
        view: { kind: "app", provider: "slack", from: "start" },
        query: "post",
      },
    ).items;
    const groups = items.flatMap((item) =>
      item.type === "group"
        ? [{ group: item.group, open: item.open, count: item.count }]
        : [],
    );
    expect(groups).toEqual([{ group: "actions", open: true, count: 1 }]);
    expect(labelsOf(items)).toEqual([
      strings.creator.actions,
      "Post a message",
    ]);
  });

  it("says nothing matches in an app, and offers the agent", () => {
    const items = list(
      { kind: "append" },
      {
        view: { kind: "app", provider: "slack", from: "start" },
        query: "zzqx",
      },
    ).items;
    expect(items.map((item) => item.type)).toEqual(["notice", "describe"]);
  });

  it("drops the app's name from its rows inside the app, and keeps it everywhere else", () => {
    const inside = list(
      { kind: "append" },
      {
        hasTrigger: true,
        view: { kind: "app", provider: "slack", from: "next" },
      },
    ).items;
    expect(labelsOf(inside)).toContain("Post a message");
    expect(labelsOf(inside)).not.toContain("Slack: post a message");
    const ai = list(
      { kind: "append" },
      { hasTrigger: true, view: { kind: "list", list: "ai" } },
    ).items;
    expect(labelsOf(ai)).toContain("Builder: start a task");
  });

  it("captions an app's lookups and actions only when its group holds both", () => {
    const items = list(
      { kind: "append" },
      {
        hasTrigger: true,
        view: { kind: "app", provider: "email", from: "next" },
      },
    ).items;
    expect(items.some((item) => item.type === "caption")).toBe(false);
    expect(labelsOf(items)).toContain("Send a message");
  });

  it("matches an app's rows by their full names, so typing the app's name still finds them", () => {
    const items = list(
      { kind: "append" },
      {
        hasTrigger: true,
        view: { kind: "app", provider: "slack", from: "next" },
        query: "slack post",
      },
    ).items;
    expect(labelsOf(items)).toEqual([
      strings.creator.actions,
      "Post a message",
    ]);
  });
});

describe("search", () => {
  it("searches every step on the root as one flat list, with no apps or groups", () => {
    const items = list(
      { kind: "append" },
      { hasTrigger: true, query: "slack" },
    ).items;
    // oracle-change: the apps' API request steps stand as one row that opens the list of apps, and it is the one row that is not a step
    expect(
      items.flatMap((item) => (item.type === "entry" ? [] : [item])),
    ).toEqual([expect.objectContaining({ id: "list:apiRequest" })]);
    expect(labelsOf(items)).toContain("Slack: post a message");
  });

  it("ranks a name that starts with the query above a word that matches later", () => {
    const labels = labelsOf(
      list({ kind: "append" }, { hasTrigger: true, query: "slack" }).items,
    );
    expect(labels.indexOf("Slack: post a message")).toBeLessThan(
      labels.indexOf(strings.palette.watchSlackInbox),
    );
  });

  it("ignores a trailing trigger word", () => {
    const target: CreatorTarget = { kind: "append" };
    expect(labelsOf(list(target, { query: "slack trigger" }).items)).toEqual(
      labelsOf(list(target, { query: "slack" }).items),
    );
  });

  it("offers the agent when nothing matches, and nothing else when it cannot", () => {
    const target: CreatorTarget = { kind: "append" };
    expect(
      list(target, { query: "zzqx" }).items.map((item) => item.type),
    ).toEqual(["notice", "describe"]);
    expect(
      list(target, { query: "zzqx", describable: false }).items.map(
        (item) => item.type,
      ),
    ).toEqual(["notice"]);
  });

  it("shows the search box on the root always, and on a list only above eight rows", () => {
    const target: CreatorTarget = { kind: "append" };
    expect(list(target).searchable).toBe(true);
    expect(
      list(target, { view: { kind: "list", list: "ai" } }).searchable,
    ).toBe(false);
    expect(
      list(target, { view: { kind: "list", list: "actions" } }).searchable,
    ).toBe(true);
  });
});

const API_REQUEST_KEYWORDS = [
  "http",
  "api",
  "request",
  "rest",
  "endpoint",
  "fetch",
  "get",
  "curl",
];
const API_REQUEST_APPS = [
  "bigquery",
  "gong",
  "github",
  "hubspot",
  "jira",
  "notion",
  "posthog",
  "pylon",
  "sentry",
  "slack",
  "stripe",
];
const NEXT: CreatorTarget = {
  kind: "append",
  after: { nodeId: "n", port: "out" },
};
const API_REQUEST_LIST: CreatorView = { kind: "list", list: "apiRequest" };

function apiRequestRows(items: CreatorItem[]) {
  return selectableRows(items).flatMap((row) =>
    row.type === "providerStep" ? [row] : [],
  );
}

describe("API request", () => {
  it("is one row on the next list, with a plain description, and opens the list of apps", () => {
    const row = selectableRows(list(NEXT, { hasTrigger: true }).items).find(
      (candidate) => candidate.label === strings.creator.apiRequest,
    );
    expect(row).toMatchObject({
      type: "list",
      kind: "lookup",
      description: strings.creator.hint.apiRequest,
      view: API_REQUEST_LIST,
    });
  });

  it.each(API_REQUEST_KEYWORDS)(
    "is found once on the root by searching %s, and never as one row for each app",
    (keyword) => {
      const items = list(NEXT, { hasTrigger: true, query: keyword }).items;
      const rows = selectableRows(items);
      expect(rows.filter((row) => row.label === "API request")).toEqual([
        expect.objectContaining({ type: "list", id: "list:apiRequest" }),
      ]);
      expect(
        rows.filter(
          (row) =>
            row.type === "entry" &&
            row.entry.options.operationId?.endsWith(".apiRequest"),
        ),
      ).toEqual([]);
    },
  );

  it("shows once in every root search, however many apps the query names", () => {
    for (const query of ["", "slack", "github", "api request", "lookup"]) {
      const rows = selectableRows(
        list(NEXT, { hasTrigger: true, query }).items,
      );
      expect(
        rows.filter((row) => row.label === strings.creator.apiRequest).length,
      ).toBeLessThanOrEqual(1);
      expect(
        rows.filter(
          (row) =>
            row.type === "entry" &&
            row.entry.options.operationId?.endsWith(".apiRequest"),
        ),
      ).toEqual([]);
    }
  });

  it("is on the root of an insertion into a connection too", () => {
    expect(
      labelsOf(
        list({ kind: "insert", edgeId: "e" }, { hasTrigger: true }).items,
      ),
    ).toContain(strings.creator.apiRequest);
  });

  it("lists the eleven apps, alphabetical until their connection is known, each adding its own step", () => {
    const view = list(NEXT, { hasTrigger: true, view: API_REQUEST_LIST });
    expect(view.searchable).toBe(true);
    const rows = apiRequestRows(view.items);
    expect(rows.map((row) => row.provider)).toEqual(
      [...API_REQUEST_APPS].sort((a, b) =>
        providerIdentity(a).label.localeCompare(providerIdentity(b).label),
      ),
    );
    for (const row of rows) {
      expect(row.entry.options.operationId).toBe(`${row.provider}.apiRequest`);
      expect(row.entry.kind).toBe("lookup");
      expect(row.label).toBe(providerIdentity(row.provider).label);
    }
    expect(view.items.every((item) => item.type === "providerStep")).toBe(true);
  });

  it("lists the connected apps first, each half alphabetical", () => {
    const rows = apiRequestRows(
      list(NEXT, {
        hasTrigger: true,
        view: API_REQUEST_LIST,
        connections: {
          stripe: "connected",
          github: "connected",
          slack: "not connected",
          jira: "unknown",
        },
      }).items,
    );
    expect(rows.map((row) => row.label)).toEqual([
      "GitHub",
      "Stripe",
      "BigQuery",
      "Gong",
      "HubSpot",
      "Jira",
      "Notion",
      "PostHog",
      "Pylon",
      "Sentry",
      "Slack",
    ]);
  });

  it("narrows the list of apps by a search", () => {
    const rows = apiRequestRows(
      list(NEXT, {
        hasTrigger: true,
        view: API_REQUEST_LIST,
        query: "sl",
      }).items,
    );
    expect(rows.map((row) => row.provider)).toEqual(["slack"]);
  });

  it("is pinned after every other row in each app's actions, once", () => {
    for (const provider of API_REQUEST_APPS) {
      const entries = selectableRows(
        list(NEXT, {
          hasTrigger: true,
          view: { kind: "app", provider, from: "next" },
        }).items,
      ).flatMap((row) => (row.type === "entry" ? [row] : []));
      expect(last(entries)?.label).toBe("API request");
      expect(last(entries)?.entry.options.operationId).toBe(
        `${provider}.apiRequest`,
      );
      expect(entries.filter((row) => row.label === "API request")).toHaveLength(
        1,
      );
    }
  });

  it("is pinned last from the start list's apps too, without captions", () => {
    const items = list(NEXT, {
      hasTrigger: true,
      view: { kind: "app", provider: "slack", from: "start" },
      query: "slack",
    }).items;
    expect(items.some((item) => item.type === "caption")).toBe(false);
    expect(last(labelsOf(items))).toBe("API request");
  });

  it("stays last in an app when a search ranks every row alike", () => {
    const actions = selectableRows(
      list(NEXT, {
        hasTrigger: true,
        view: { kind: "app", provider: "slack", from: "next" },
        query: "slack",
      }).items,
    ).flatMap((row) =>
      row.type === "entry" && row.entry.kind !== "source" ? [row.label] : [],
    );
    expect(last(actions)).toBe("API request");
    expect(actions).toContain("Post a message");
  });

  it("is found inside an app by the same words", () => {
    for (const query of API_REQUEST_KEYWORDS) {
      const labels = labelsOf(
        list(NEXT, {
          hasTrigger: true,
          view: { kind: "app", provider: "github", from: "next" },
          query,
        }).items,
      );
      expect(labels).toContain("API request");
    }
  });

  it("is the only row of an app with nothing else to do, and then has no caption", () => {
    const items = list(NEXT, {
      hasTrigger: true,
      view: { kind: "app", provider: "jira", from: "next" },
    }).items;
    expect(labelsOf(items)).toEqual([
      strings.creator.actions,
      "Create an issue",
      "API request",
    ]);
    expect(items.some((item) => item.type === "caption")).toBe(false);
  });

  it("keeps an app whose only action is the API request out of the list of apps with actions", () => {
    const providers = selectableRows(
      list(NEXT, { hasTrigger: true, view: { kind: "list", list: "actions" } })
        .items,
    ).flatMap((row) => (row.type === "provider" ? [row.provider] : []));
    expect(providers).toContain("jira");
    expect(providers).not.toContain("bigquery");
  });

  it("is never offered where the first step goes", () => {
    const first: CreatorTarget = { kind: "append" };
    for (const query of ["", ...API_REQUEST_KEYWORDS, "slack"]) {
      const items = list(first, { query }).items;
      expect(labelsOf(items)).not.toContain(strings.creator.apiRequest);
      expect(labelsOf(items)).not.toContain("API request");
    }
    expect(labelsOf(list(first, { view: API_REQUEST_LIST }).items)).toEqual([]);
    const inApp = list(first, {
      view: { kind: "app", provider: "slack", from: "start" },
      query: "api",
    }).items;
    expect(labelsOf(inApp)).not.toContain("API request");
    expect(
      labelsOf(
        list(first, {
          view: { kind: "app", provider: "slack", from: "start" },
        }).items,
      ),
    ).not.toContain("API request");
  });
});

describe("empty search", () => {
  it("links the API request step under the no-results line, above the agent", () => {
    const items = list(NEXT, { hasTrigger: true, query: "zzqx" }).items;
    expect(items.map((item) => item.type)).toEqual([
      "notice",
      "tip",
      "describe",
    ]);
    expect(items[1]).toEqual({
      type: "tip",
      id: "tip:apiRequest",
      before: "Read any endpoint of a connected app with the ",
      link: strings.creator.apiRequestLink,
      after: ".",
      view: API_REQUEST_LIST,
    });
  });

  it("keeps the whole sentence, then the link, when a translation leaves out the link's place", () => {
    const english = createEnglishTranslator();
    const unplaced = createWorkflowCanvasStrings((key, options) =>
      key === "workflowCanvas.creator.apiRequestTip"
        ? "Read any endpoint."
        : english(key, options),
    );
    const tip = creatorList({
      catalog,
      target: NEXT,
      hasTrigger: true,
      view: { kind: "root" },
      query: "zzqx",
      open: {},
      describable: false,
      strings: unplaced,
    }).items.find((item) => item.type === "tip");
    expect(tip).toMatchObject({
      before: "Read any endpoint.",
      link: unplaced.creator.apiRequestLink,
      after: "",
    });
  });

  it("keeps the tip when the agent cannot be offered, and leaves it out of the keyboard's rows", () => {
    const items = list(NEXT, {
      hasTrigger: true,
      query: "zzqx",
      describable: false,
    }).items;
    expect(items.map((item) => item.type)).toEqual(["notice", "tip"]);
    expect(selectableRows(items)).toEqual([]);
  });

  it("opens a list whose rows add each app's step", () => {
    const tip = list(NEXT, { hasTrigger: true, query: "zzqx" }).items.find(
      (item) => item.type === "tip",
    );
    if (tip?.type !== "tip") throw new Error("expected a tip");
    expect(
      apiRequestRows(list(NEXT, { hasTrigger: true, view: tip.view }).items),
    ).toHaveLength(API_REQUEST_APPS.length);
  });

  it("offers no tip on the start list, where the step cannot go, nor inside an app", () => {
    expect(
      list({ kind: "append" }, { query: "zzqx" }).items.map(
        (item) => item.type,
      ),
    ).toEqual(["notice", "describe"]);
    expect(
      list(NEXT, {
        hasTrigger: true,
        view: { kind: "app", provider: "slack", from: "next" },
        query: "zzqx",
      }).items.map((item) => item.type),
    ).toEqual(["notice", "describe"]);
  });
});

describe("intent lists", () => {
  it("lists the data steps in the order the plan gives them", () => {
    const labels = labelsOf(
      list(
        { kind: "append" },
        { hasTrigger: true, view: { kind: "list", list: "data" } },
      ).items,
    );
    expect(labels).toEqual([
      strings.palette.filter,
      strings.palette.split,
      strings.palette.combineList,
      strings.palette.combineCount,
      strings.palette.combineGroup,
      strings.palette.combineSummarize,
    ]);
  });

  it("keeps an end out of a connection", () => {
    const flow = labelsOf(
      list(
        { kind: "insert", edgeId: "e" },
        { hasTrigger: true, view: { kind: "list", list: "flow" } },
      ).items,
    );
    expect(flow).toContain(strings.palette.switch);
    expect(flow).not.toContain(strings.palette.finish);
  });

  it("keeps a source out of a connection", () => {
    expect(
      list(
        { kind: "insert", edgeId: "e" },
        { view: { kind: "list", list: "sources" } },
      ).items,
    ).toEqual([]);
  });
});

describe("moveHighlight", () => {
  const rows: CreatorRow[] = [
    {
      type: "provider",
      id: "provider:slack",
      label: "Slack",
      provider: "slack",
      view: { kind: "root" },
    },
    { type: "describe", id: "describe", label: "Describe" },
  ];

  it("starts on the first row and moves between rows", () => {
    expect(highlightedRow(rows, null)?.id).toBe("provider:slack");
    expect(highlightedRow(rows, "gone")?.id).toBe("provider:slack");
    expect(moveHighlight(rows, "provider:slack", 1)).toBe("describe");
    expect(moveHighlight(rows, "describe", -1)).toBe("provider:slack");
  });

  it("wraps from the last row to the first, and from the first to the last", () => {
    expect(moveHighlight(rows, "describe", 1)).toBe("provider:slack");
    expect(moveHighlight(rows, "provider:slack", -1)).toBe("describe");
  });

  it("has nothing to move to in an empty list", () => {
    expect(moveHighlight([], null, 1)).toBeNull();
  });
});

describe("horizontalKey", () => {
  it("goes back or collapses with Left in an empty box, and opens with Right", () => {
    const empty = { query: "", caretAtEnd: true, onOpenGroup: false };
    expect(horizontalKey("left", empty)).toBe("back");
    expect(horizontalKey("left", { ...empty, onOpenGroup: true })).toBe(
      "collapse",
    );
    expect(horizontalKey("right", empty)).toBe("activate");
  });

  it("leaves the arrows to the text while the box has text, and opens only at the end on Right", () => {
    expect(
      horizontalKey("left", {
        query: "x",
        caretAtEnd: true,
        onOpenGroup: false,
      }),
    ).toBe("caret");
    expect(
      horizontalKey("right", {
        query: "x",
        caretAtEnd: false,
        onOpenGroup: false,
      }),
    ).toBe("caret");
    expect(
      horizontalKey("right", {
        query: "x",
        caretAtEnd: true,
        onOpenGroup: false,
      }),
    ).toBe("activate");
  });
});

describe("insertOnEdge", () => {
  it("splices the step into the connection and keeps the rest of the flow", () => {
    const { graph, wait, filter, forward } = sample();
    const outcome = insertOnEdge(graph, catalog, forward, "filter");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || "reason" in outcome) return;
    const { node, graph: next } = outcome;
    expect(next.edges.some((edge) => edge.id === forward)).toBe(false);
    expect(
      next.edges.some(
        (edge) => edge.from.node === wait && edge.to.node === node.id,
      ),
    ).toBe(true);
    expect(
      next.edges.some(
        (edge) => edge.from.node === node.id && edge.to.node === filter,
      ),
    ).toBe(true);
    expect(graph.edges.some((edge) => edge.id === forward)).toBe(true);
  });

  it("refuses a loop's back-edge", () => {
    const { graph, loop } = sample();
    expect(insertOnEdge(graph, catalog, loop, "filter")).toEqual({
      ok: false,
      reason: "loop",
    });
  });

  it("refuses an end, which has no output to continue from", () => {
    const { graph, trigger, wait } = sample();
    const starting = graph.edges.find(
      (edge) => edge.from.node === trigger && edge.to.node === wait,
    );
    const outcome = insertOnEdge(graph, catalog, starting?.id ?? "", "end");
    expect(outcome.ok).toBe(false);
    if (outcome.ok || "reason" in outcome) return;
    expect(outcome.rejection.code).toBe("unknown_port");
  });

  it("reports an edge that is not in the graph", () => {
    const { graph } = sample();
    const outcome = insertOnEdge(graph, catalog, "missing", "filter");
    expect(outcome.ok).toBe(false);
    if (outcome.ok || "reason" in outcome) return;
    expect(outcome.rejection.code).toBe("unknown_edge");
  });
});
