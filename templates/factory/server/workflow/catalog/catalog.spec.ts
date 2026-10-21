import { PROVIDER_API_IDS } from "@agent-native/core/provider-api";
import { describe, expect, it } from "vitest";

import { validateWorkflowGraph } from "../graph-validation.js";
import {
  isWriteAllowedForNode,
  type OperationDefinition,
  type OperationNodeKind,
} from "../operations.js";
import {
  STORY_GRAPHS,
  aiWritten,
  buildGraph,
  type NodeSpec,
} from "../story-graphs.fixture.js";
import {
  OPERATION_CATALOG,
  OPERATION_DEFINITIONS,
  buildOperationCatalog,
} from "./index.js";

const KNOWN_PROVIDERS = new Set<string>([
  ...PROVIDER_API_IDS,
  "slack",
  "github",
  "builder",
  "email",
  "factory",
]);

// An operation nobody uses must be listed here with the reason it stays.
const UNUSED_ON_PURPOSE: { id: string; reason: string }[] = [];

// A read that is a POST must be listed here with the reason it is still a read.
const POST_READS: Record<string, string> = {
  "hubspot.newLeads": "CRM search takes its filters in a POST body",
  "pylon.newTickets": "ticket search takes its filter in a POST body",
  "gong.transcript": "the transcript endpoint takes call ids in a POST body",
  "posthog.usage": "HogQL queries are sent as a POST body",
  "bigquery.billingQuery": "jobs.query is a POST that runs a read-only SELECT",
};

// Braces that belong to the provider's own syntax and are never filled in.
const LITERAL_BRACES: Record<string, string[]> = {
  "posthog.usage": ["customer", "windowDays"],
};

// The billing query is anchored to the window's end; its start is unused.
const UNUSED_WINDOW_START = ["bigquery.billingQuery"];

// What the host has to implement for `implementation.type: "action"`.
const HOST_ACTIONS = [
  "create-hubspot-task",
  "get-factory-merge-gate",
  "get-factory-pull-request",
  "list-factory-items",
  "merge-factory-pull-request",
  "post-slack-message",
  "read-slack-thread",
  "send-factory-email",
];

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(stringsIn);
  }
  return [];
}

function placeholders(strings: string[]): Set<string> {
  return new Set(
    strings.flatMap((text) =>
      [...text.matchAll(PLACEHOLDER)].map((match) => match[1]),
    ),
  );
}

interface Use {
  story: string;
  node: string;
  id: string;
  as: OperationNodeKind | "tool";
}

function usesIn(
  story: string,
  graph: (typeof STORY_GRAPHS)[keyof typeof STORY_GRAPHS],
) {
  return graph.nodes.flatMap((node): Use[] => {
    const at = { story, node: node.id };
    switch (node.kind) {
      case "source":
        return node.settings.source === "provider-query" ||
          node.settings.source === "window"
          ? [{ ...at, id: node.settings.operation, as: "source" }]
          : [];
      case "lookup":
        return [{ ...at, id: node.settings.operation, as: "lookup" }];
      case "action":
        return [{ ...at, id: node.settings.operation, as: "action" }];
      case "agent":
        return [
          {
            ...at,
            id: `${node.settings.agent}.${node.settings.op}`,
            as: "agent",
          },
        ];
      case "wait":
        return node.settings.wait === "condition"
          ? [{ ...at, id: node.settings.operation, as: "lookup" }]
          : [];
      case "ai":
        return node.settings.tools.map((id) => ({ ...at, id, as: "tool" }));
      default:
        return [];
    }
  });
}

const uses = Object.entries(STORY_GRAPHS).flatMap(([story, graph]) =>
  usesIn(story, graph),
);
const definitions = OPERATION_CATALOG.list();
const byId = (id: string): OperationDefinition => {
  const found = OPERATION_CATALOG.get(id);
  if (!found) throw new Error(`no operation ${id}`);
  return found;
};

describe("the operation catalog", () => {
  it("builds, parsing every definition", () => {
    expect(() => buildOperationCatalog()).not.toThrow();
    expect(definitions).toHaveLength(OPERATION_DEFINITIONS.length);
  });

  it("has unique ids", () => {
    const ids = definitions.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("cannot be added to once built", () => {
    expect("register" in OPERATION_CATALOG).toBe(false);
  });

  describe("against the ten story graphs", () => {
    it("has every operation a story node uses", () => {
      const missing = uses.filter((use) => !OPERATION_CATALOG.get(use.id));
      expect(missing).toEqual([]);
    });

    it("lets every use run on the kind of node that names it", () => {
      const refused = uses.filter((use) => {
        const def = byId(use.id);
        return use.as === "tool"
          ? def.effect !== "read" || !isWriteAllowedForNode(def, "lookup")
          : !isWriteAllowedForNode(def, use.as);
      });
      expect(refused).toEqual([]);
    });

    it("has no operation nobody uses, unless it says why", () => {
      const used = new Set(uses.map((use) => use.id));
      const allowed = new Set(UNUSED_ON_PURPOSE.map((entry) => entry.id));
      const orphans = definitions
        .map((definition) => definition.id)
        .filter((id) => !used.has(id) && !allowed.has(id));
      expect(orphans).toEqual([]);
      for (const entry of UNUSED_ON_PURPOSE) {
        expect(OPERATION_CATALOG.get(entry.id), entry.id).toBeDefined();
        expect(entry.reason.length, entry.id).toBeGreaterThan(0);
        expect(used.has(entry.id), `${entry.id} is used after all`).toBe(false);
      }
    });

    it("validates every story graph", () => {
      for (const [story, graph] of Object.entries(STORY_GRAPHS)) {
        expect(validateWorkflowGraph(graph, OPERATION_CATALOG), story).toEqual({
          ok: true,
          issues: [],
        });
      }
    });
  });

  describe("providers", () => {
    it("names only providers it knows", () => {
      for (const def of definitions) {
        expect(KNOWN_PROVIDERS.has(def.provider), def.id).toBe(true);
        expect(
          KNOWN_PROVIDERS.has(def.credential.provider),
          `${def.id} credential`,
        ).toBe(true);
      }
    });
  });

  describe("provider requests", () => {
    const requests = definitions.flatMap((def) =>
      def.implementation.type === "provider-request"
        ? [{ def, request: def.implementation }]
        : [],
    );

    function templateOf(def: OperationDefinition) {
      if (def.implementation.type !== "provider-request") {
        throw new Error(`${def.id} is not a provider request`);
      }
      const { pathTemplate, query, bodyTemplate } = def.implementation;
      return {
        path: placeholders([pathTemplate]),
        rest: placeholders([
          ...Object.values(query ?? {}),
          ...stringsIn(bodyTemplate),
        ]),
      };
    }

    it("fills every path placeholder from a declared field", () => {
      for (const { def } of requests) {
        const fields = new Set(def.fields.map((field) => field.name));
        for (const name of templateOf(def).path) {
          expect(fields.has(name), `${def.id} {${name}}`).toBe(true);
        }
      }
    });

    it("fills every query and body placeholder from a field or the engine", () => {
      for (const { def } of requests) {
        const known = new Set([
          ...def.fields.map((field) => field.name),
          ...[
            def.cursor?.param,
            def.cursor?.forward?.sortParam,
            def.window?.fromParam,
            def.window?.toParam,
          ],
          ...(LITERAL_BRACES[def.id] ?? []),
        ]);
        for (const name of templateOf(def).rest) {
          expect(known.has(name), `${def.id} {${name}}`).toBe(true);
        }
      }
    });

    it("uses every declared field, so no binding is silently ignored", () => {
      for (const { def } of requests) {
        const { path, rest } = templateOf(def);
        for (const field of def.fields) {
          expect(
            path.has(field.name) || rest.has(field.name),
            `${def.id} field ${field.name}`,
          ).toBe(true);
        }
      }
    });

    it("keeps engine-supplied names out of the fields a node can bind", () => {
      for (const def of definitions) {
        const engine = [
          def.cursor?.param,
          def.cursor?.forward?.sortParam,
          def.window?.fromParam,
          def.window?.toParam,
          ...(LITERAL_BRACES[def.id] ?? []),
        ];
        for (const name of engine) {
          expect(
            def.fields.some((field) => field.name === name),
            `${def.id} ${name}`,
          ).toBe(false);
        }
      }
    });

    it("sends the cursor and the window through the request", () => {
      for (const { def } of requests) {
        const { rest } = templateOf(def);
        if (def.cursor) {
          expect(rest.has(def.cursor.param), `${def.id} cursor`).toBe(true);
        }
        if (def.cursor?.forward) {
          expect(rest.has(def.cursor.forward.sortParam), `${def.id} sort`).toBe(
            true,
          );
        }
        if (def.window) {
          expect(rest.has(def.window.toParam), `${def.id} until`).toBe(true);
          if (!UNUSED_WINDOW_START.includes(def.id)) {
            expect(rest.has(def.window.fromParam), `${def.id} since`).toBe(
              true,
            );
          }
        }
      }
    });

    it("never reads with PUT, PATCH or DELETE, and lists every POST read", () => {
      for (const { def, request } of requests) {
        if (def.effect !== "read") continue;
        expect(["GET", "POST"], def.id).toContain(request.method);
        if (request.method === "POST") {
          expect(
            POST_READS[def.id],
            `${def.id} needs a POST_READS reason`,
          ).toBeTruthy();
        }
      }
      for (const id of Object.keys(POST_READS)) {
        const def = byId(id);
        expect(def.effect, id).toBe("read");
        expect(def.readsViaPost, `${id} declares readsViaPost`).toBe(true);
        expect(
          def.implementation.type === "provider-request" &&
            def.implementation.method === "POST",
          `${id} is no longer a POST`,
        ).toBe(true);
      }
    });

    it("never writes with GET", () => {
      for (const { def, request } of requests) {
        if (def.effect === "write") {
          expect(request.method, def.id).not.toBe("GET");
        }
      }
    });

    it("never gives a read the endpoint a write of the same provider uses", () => {
      const writes = new Set(
        requests
          .filter(({ def }) => def.effect === "write")
          .map(
            ({ def, request }) =>
              `${def.provider} ${request.method} ${request.pathTemplate}`,
          ),
      );
      for (const { def, request } of requests) {
        if (def.effect !== "read") continue;
        expect(
          writes.has(
            `${def.provider} ${request.method} ${request.pathTemplate}`,
          ),
          def.id,
        ).toBe(false);
      }
    });
  });

  describe("actions", () => {
    const actions = definitions.flatMap((def) =>
      def.implementation.type === "action"
        ? [{ def, implementation: def.implementation }]
        : [],
    );

    it("needs exactly the host actions the host is told about", () => {
      const names = [
        ...new Set(actions.map(({ implementation }) => implementation.action)),
      ].sort();
      expect(names).toEqual([...HOST_ACTIONS].sort());
    });

    it("maps every field to an action argument when it maps any", () => {
      for (const { def, implementation } of actions) {
        if (!implementation.argMap) continue;
        expect(Object.keys(implementation.argMap).sort(), def.id).toEqual(
          def.fields.map((field) => field.name).sort(),
        );
      }
    });
  });

  describe("target fields", () => {
    const targets = definitions.flatMap((def) =>
      def.fields
        .filter((field) => field.target)
        .map((field) => ({ def, field })),
    );

    // Every field that decides who or where a write lands. Taking a flag off
    // one lets a model pick it, so that is a decision made in this list.
    it("flags exactly the fields that decide who or where a write lands", () => {
      expect(
        targets.map(({ def, field }) => `${def.id}.${field.name}`).sort(),
      ).toEqual([
        "builder.followUp.branchName",
        "builder.followUp.projectId",
        "builder.start.branchName",
        "builder.start.projectId",
        "builder.start.userEmail",
        "email.send.cc",
        "email.send.replyTo",
        "email.send.to",
        "github.mergePullRequest.number",
        "github.mergePullRequest.repo",
        "hubspot.addToList.leadId",
        "hubspot.addToList.listId",
        "hubspot.createTask.contactId",
        "hubspot.createTask.ownerId",
        "jira.createIssue.projectKey",
        "notion.createPage.parentPageId",
        "pylon.addNote.ticketId",
        "pylon.reply.messageId",
        "pylon.reply.ticketId",
        "slack.postMessage.allowMentions",
        "slack.postMessage.to",
        "slack.replyInThread.allowMentions",
        "slack.replyInThread.channel",
        "slack.replyInThread.threadTs",
      ]);
    });

    it("sits only on writes, and no catalog entry lets a model write one", () => {
      for (const { def, field } of targets) {
        expect(def.effect, `${def.id}.${field.name}`).toBe("write");
        expect(field.modelMayWrite, `${def.id}.${field.name}`).toBeUndefined();
      }
    });

    it.each(
      targets.map(
        ({ def, field }) => [`${def.id}.${field.name}`, def, field] as const,
      ),
    )("refuses %s written by the AI", (_label, def, field) => {
      const args = { [field.name]: aiWritten("Choose it.") };
      const node: NodeSpec =
        def.implementation.type === "builder"
          ? [
              "step",
              "agent",
              { agent: "builder", op: def.implementation.op, args },
            ]
          : ["step", "action", { operation: def.id, args }];
      const issues = validateWorkflowGraph(
        buildGraph({ nodes: [node], edges: [] }),
        OPERATION_CATALOG,
      ).issues.filter((issue) => issue.code === "model_written_target");
      expect(issues).toHaveLength(1);
      expect(issues[0].detail).toContain(`args.${field.name}`);
    });
  });

  describe("effects", () => {
    it("gives every write a receipt and no read one", () => {
      for (const def of definitions) {
        if (def.effect === "write") {
          expect(def.receipt, `${def.id} needs a receipt`).toBeDefined();
        } else {
          expect(
            def.receipt,
            `${def.id} reads, so it has no receipt`,
          ).toBeUndefined();
        }
      }
    });

    it("lets a write run only on an action or an agent node", () => {
      for (const def of definitions) {
        if (def.effect === "write") {
          expect(
            def.nodeKinds.every(
              (kind) => kind === "action" || kind === "agent",
            ),
            def.id,
          ).toBe(true);
        }
      }
    });
  });

  describe("sources", () => {
    it("map a title and a time, and name what makes an item unique", () => {
      for (const def of definitions) {
        if (!def.nodeKinds.includes("source")) continue;
        expect(def.itemMapping?.fields.title, def.id).toBeDefined();
        expect(def.itemMapping?.fields.occurredAt, def.id).toBeDefined();
        expect(def.itemMapping?.dedupeKey, def.id).toBeTruthy();
      }
    });

    it("name where a cursor source starts when the first page is empty", () => {
      for (const def of definitions) {
        if (!def.cursor) continue;
        expect(def.cursor.origin, def.id).toBeTruthy();
      }
    });

    it("end every title in a template fallback, or say why none is needed", () => {
      const TITLE_NEVER_EMPTY: Record<string, string> = {
        "bigquery.billingQuery":
          "a row with no service has no key either, so it fails as untrackable before a title could help",
      };
      for (const def of definitions) {
        const title = def.itemMapping?.fields.title;
        if (title === undefined) continue;
        if (TITLE_NEVER_EMPTY[def.id]) {
          expect(typeof title, def.id).toBe("string");
          continue;
        }
        expect(Array.isArray(title), `${def.id} title chain`).toBe(true);
        const chain = [title].flat();
        expect(chain[chain.length - 1], def.id).toContain("{");
      }
    });

    it("read through a cursor or a window, never both", () => {
      for (const def of definitions) {
        expect(!(def.cursor && def.window), def.id).toBe(true);
      }
    });
  });

  it("holds no secret, token or real address", () => {
    const text = JSON.stringify(OPERATION_DEFINITIONS);
    expect(text).not.toMatch(/https?:\/\//i);
    expect(text).not.toMatch(/\bBearer\b/i);
    expect(text).not.toMatch(
      /\b(?:xox[abprs]-|ghp_|github_pat_|sk_live_|sk_test_|AKIA[0-9A-Z]{8})/,
    );
  });
});
