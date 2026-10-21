import { describe, expect, it } from "vitest";

import {
  buildOperationCatalog,
  OPERATION_DEFINITIONS,
} from "./catalog/index.js";
import { validateWorkflowGraph } from "./graph-validation.js";
import {
  OperationRegistryError,
  createOperationRegistry,
  isWriteAllowedForNode,
  operationDefinitionSchema,
  type OperationDefinitionInput,
} from "./operations.js";
import { STORY_GRAPHS } from "./story-graphs.fixture.js";

const mapping = {
  kind: "ticket" as const,
  itemsPath: "data.tickets",
  fields: {
    title: "subject",
    text: "body",
    url: "links.web",
    author: "requester.email",
    occurredAt: "created_at",
    "thread.ticketId": "id",
    "extras.priority": "priority",
  },
  dedupeKey: "id",
};

const lookup: OperationDefinitionInput = {
  id: "pylon.ticketThread",
  provider: "pylon",
  label: "Pylon: read ticket thread",
  nodeKinds: ["lookup"],
  effect: "read",
  fields: [
    { name: "ticketId", type: "string", required: true, label: "Ticket" },
    { name: "includeNotes", type: "boolean", default: false },
  ],
  implementation: {
    type: "provider-request",
    method: "GET",
    pathTemplate: "/issues/{ticketId}/messages",
  },
  credential: { provider: "pylon" },
};

const source: OperationDefinitionInput = {
  ...lookup,
  id: "pylon.newTickets",
  label: "Pylon: new tickets",
  nodeKinds: ["source"],
  readsViaPost: true,
  fields: [],
  implementation: {
    type: "provider-request",
    method: "POST",
    pathTemplate: "/issues/search",
    bodyTemplate: { createdAfter: "{since}" },
  },
  itemMapping: mapping,
  cursor: { param: "since", path: "data.nextSince" },
};

const action: OperationDefinitionInput = {
  ...lookup,
  id: "pylon.reply",
  label: "Pylon: reply to the customer",
  nodeKinds: ["action"],
  effect: "write",
  fields: [{ name: "text", type: "text", required: true }],
  implementation: {
    type: "action",
    action: "pylon-reply",
    argMap: { text: "body" },
  },
  receipt: { externalRef: "data.id", url: "data.url" },
};

const builderStart: OperationDefinitionInput = {
  id: "builder.start",
  provider: "builder",
  label: "Builder: start a task",
  nodeKinds: ["agent"],
  effect: "write",
  fields: [{ name: "prompt", type: "text", required: true }],
  implementation: { type: "builder", op: "start" },
  receipt: { externalRef: "branchName", url: "url" },
  credential: { provider: "builder" },
};

const accepts = (definition: unknown) =>
  operationDefinitionSchema.safeParse(definition).success;

describe("operationDefinitionSchema", () => {
  it("accepts a lookup, a source, an action and a builder operation", () => {
    for (const definition of [lookup, source, action, builderStart]) {
      expect(accepts(definition), definition.id).toBe(true);
    }
  });

  it("accepts a window source and a source that is also a lookup", () => {
    expect(
      accepts({
        ...source,
        window: { fromParam: "since", toParam: "until" },
      }),
    ).toBe(true);
    expect(accepts({ ...source, nodeKinds: ["source", "lookup"] })).toBe(true);
  });

  it("requires the id to be provider.name and to start with the provider", () => {
    expect(accepts({ ...lookup, id: "ticketThread" })).toBe(false);
    expect(accepts({ ...lookup, id: "Pylon.ticketThread" })).toBe(false);
    expect(accepts({ ...lookup, id: "stripe.ticketThread" })).toBe(false);
  });

  it("rejects unknown keys and unknown node kinds", () => {
    expect(accepts({ ...lookup, retries: 3 })).toBe(false);
    expect(accepts({ ...lookup, nodeKinds: ["filter"] })).toBe(false);
    expect(accepts({ ...lookup, nodeKinds: [] })).toBe(false);
    expect(accepts({ ...lookup, nodeKinds: ["lookup", "lookup"] })).toBe(false);
  });

  it("keeps effect consistent with the node kinds it serves", () => {
    expect(accepts({ ...lookup, effect: "write" })).toBe(false);
    expect(accepts({ ...action, effect: "read" })).toBe(false);
    expect(accepts({ ...source, effect: "write" })).toBe(false);
  });

  it("requires a source to declare how its results become items", () => {
    const { itemMapping: _mapping, ...bare } = source;
    expect(accepts(bare)).toBe(false);
    expect(accepts({ ...lookup, itemMapping: mapping })).toBe(false);
    expect(accepts({ ...lookup, cursor: { param: "p", path: "a" } })).toBe(
      false,
    );
    expect(
      accepts({ ...lookup, window: { fromParam: "a", toParam: "b" } }),
    ).toBe(false);
  });

  describe("item mapping", () => {
    const withFields = (fields: Record<string, string | string[]>) =>
      accepts({ ...source, itemMapping: { ...mapping, fields } });

    it("must fill title and occurredAt", () => {
      expect(withFields({ title: "a", occurredAt: "b" })).toBe(true);
      expect(withFields({ occurredAt: "b" })).toBe(false);
      expect(withFields({ title: "a" })).toBe(false);
    });

    it("maps only fields an item has", () => {
      const base = { title: "a", occurredAt: "b" };
      expect(withFields({ ...base, id: "x" })).toBe(false);
      expect(withFields({ ...base, kind: "x" })).toBe(false);
      expect(withFields({ ...base, "thread.unknown": "x" })).toBe(false);
      expect(withFields({ ...base, "extras.a b": "x" })).toBe(false);
      expect(withFields({ ...base, "extras.__proto__": "x" })).toBe(false);
      expect(withFields({ ...base, "extras.constructor": "x" })).toBe(false);
      expect(withFields({ ...base, "thread.channelId": "c" })).toBe(true);
    });

    it("reads response paths in the closed grammar", () => {
      const base = { occurredAt: "b" };
      expect(withFields({ ...base, title: "data.fn()" })).toBe(false);
      expect(withFields({ ...base, title: "data.__proto__" })).toBe(false);
      expect(withFields({ ...base, title: "data[0].name" })).toBe(true);
      expect(
        accepts({ ...source, itemMapping: { ...mapping, dedupeKey: "a b" } }),
      ).toBe(false);
      expect(
        accepts({ ...source, itemMapping: { ...mapping, kind: "invoice" } }),
      ).toBe(false);
    });
  });

  describe("item mapping fallbacks", () => {
    const withTitle = (title: unknown) =>
      accepts({
        ...source,
        itemMapping: {
          ...mapping,
          fields: { title, occurredAt: "created_at" },
        },
      });

    it("takes a list of paths and templates, first non-empty wins", () => {
      expect(withTitle(["a.email", "a.name"])).toBe(true);
      expect(withTitle(["a.email", "{a.first} {a.last}", "Lead {id}"])).toBe(
        true,
      );
      expect(withTitle("Lead {id}")).toBe(true);
    });

    it("keeps every entry to the closed path grammar", () => {
      expect(withTitle(["a.email", "data.fn()"])).toBe(false);
      expect(withTitle(["a.email", "{data.__proto__}"])).toBe(false);
      expect(withTitle(["a.email", "Lead {a b}"])).toBe(false);
    });

    it("needs a chain to hold at least two entries, and a template a hole", () => {
      expect(withTitle(["a.email"])).toBe(false);
      expect(withTitle([])).toBe(false);
      expect(withTitle(Array.from({ length: 7 }, (_, i) => `a.f${i}`))).toBe(
        false,
      );
      expect(withTitle(["a.email", "Lead"])).toBe(true);
      expect(withTitle(["a.email", "Lead {}"])).toBe(false);
      expect(withTitle(["a.email", "Lead {id"])).toBe(false);
      expect(withTitle(["a.email", "Lead id}"])).toBe(false);
    });
  });

  describe("a cursor that pages forward", () => {
    const forward = {
      itemPath: "id",
      sortParam: "order",
      newestFirst: "DESC",
      oldestFirst: "ASC",
    };
    const withCursor = (cursor: unknown, fields = source.fields) =>
      accepts({ ...source, fields, cursor });

    it("names where each row's position is and which parameter sorts", () => {
      expect(
        withCursor({
          param: "since",
          path: "data[0].id",
          origin: "0",
          forward,
        }),
      ).toBe(true);
      expect(withCursor({ param: "since", path: "data[0].id", forward })).toBe(
        true,
      );
      expect(
        withCursor({
          param: "since",
          path: "data[0].id",
          forward: { ...forward, itemPath: "a b" },
        }),
      ).toBe(false);
      expect(
        withCursor({
          param: "since",
          path: "data[0].id",
          forward: { ...forward, oldestFirst: undefined },
        }),
      ).toBe(false);
    });

    it("keeps the sort parameter apart from the names a node or the engine supplies", () => {
      expect(
        withCursor({
          param: "since",
          path: "data[0].id",
          forward: { ...forward, sortParam: "since" },
        }),
      ).toBe(false);
      expect(
        withCursor(
          {
            param: "since",
            path: "data[0].id",
            forward: { ...forward, sortParam: "order" },
          },
          [{ name: "order", type: "string" }],
        ),
      ).toBe(false);
    });
  });

  it("validates fields: enum values, unique names, usable names", () => {
    const field = (extra: Record<string, unknown>) =>
      accepts({ ...lookup, fields: [{ name: "x", type: "string", ...extra }] });
    expect(field({})).toBe(true);
    expect(field({ type: "enum" })).toBe(false);
    expect(field({ type: "enum", enum: ["a", "b"] })).toBe(true);
    expect(field({ enum: ["a"] })).toBe(false);
    expect(field({ type: "datetime" })).toBe(false);
    expect(
      accepts({
        ...lookup,
        fields: [
          { name: "x", type: "string" },
          { name: "x", type: "number" },
        ],
      }),
    ).toBe(false);
    expect(
      accepts({ ...lookup, fields: [{ name: "two words", type: "string" }] }),
    ).toBe(false);
  });

  it("limits the HTTP method and validates receipt and cursor paths", () => {
    const request = (method: string) => ({
      ...action,
      implementation: { type: "provider-request", method, pathTemplate: "/x" },
    });
    expect(accepts(request("PATCH"))).toBe(true);
    expect(accepts(request("TRACE"))).toBe(false);
    expect(accepts({ ...action, receipt: { externalRef: "a()" } })).toBe(false);
    expect(
      accepts({ ...source, cursor: { param: "since", path: "a b" } }),
    ).toBe(false);
  });

  describe("a read and its HTTP method", () => {
    const read = (method: string, extra: Record<string, unknown> = {}) => ({
      ...lookup,
      ...extra,
      implementation: { type: "provider-request", method, pathTemplate: "/x" },
    });

    it("sends a GET with no marker", () => {
      expect(accepts(read("GET"))).toBe(true);
    });

    it("refuses a read that sends a POST until it declares readsViaPost", () => {
      expect(accepts(read("POST"))).toBe(false);
      expect(accepts(read("POST", { readsViaPost: true }))).toBe(true);
      const parsed = operationDefinitionSchema.safeParse(read("POST"));
      expect(parsed.success ? [] : parsed.error.issues).toMatchObject([
        { path: ["readsViaPost"], message: expect.stringMatching(/POST/) },
      ]);
    });

    it("never lets a read send a PUT, PATCH or DELETE, marker or not", () => {
      for (const method of ["PUT", "PATCH", "DELETE"]) {
        expect(accepts(read(method)), method).toBe(false);
        expect(accepts(read(method, { readsViaPost: true })), method).toBe(
          false,
        );
      }
    });

    it("keeps the marker true: only a read that sends a POST may carry it", () => {
      expect(accepts({ ...lookup, readsViaPost: true })).toBe(false);
      expect(accepts(read("GET", { readsViaPost: true }))).toBe(false);
      expect(accepts({ ...action, readsViaPost: true })).toBe(false);
      expect(
        accepts({
          ...action,
          readsViaPost: true,
          implementation: {
            type: "provider-request",
            method: "POST",
            pathTemplate: "/x",
          },
        }),
      ).toBe(false);
    });

    it("lets a write send any method without the marker", () => {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        expect(
          accepts({
            ...action,
            implementation: {
              type: "provider-request",
              method,
              pathTemplate: "/x",
            },
          }),
          method,
        ).toBe(true);
      }
    });

    it("marks exactly the catalog's POST reads", () => {
      const marked = OPERATION_DEFINITIONS.filter(
        (definition) => definition.readsViaPost,
      )
        .map((definition) => definition.id)
        .sort();
      const postReads = OPERATION_DEFINITIONS.filter(
        (definition) =>
          definition.effect === "read" &&
          definition.implementation.type === "provider-request" &&
          definition.implementation.method === "POST",
      )
        .map((definition) => definition.id)
        .sort();
      expect(marked).toEqual([
        "bigquery.billingQuery",
        "gong.transcript",
        "hubspot.newLeads",
        "posthog.usage",
        "pylon.newTickets",
      ]);
      expect(postReads).toEqual(marked);
    });
  });

  describe("target fields", () => {
    const withField = (field: Record<string, unknown>) => ({
      ...lookup,
      fields: [{ name: "to", type: "string", ...field }],
    });

    it("accepts a target, and a target a model may write", () => {
      expect(accepts(withField({ target: true }))).toBe(true);
      expect(accepts(withField({ target: true, modelMayWrite: true }))).toBe(
        true,
      );
    });

    it("refuses modelMayWrite on a field that is no target", () => {
      expect(accepts(withField({ modelMayWrite: true }))).toBe(false);
      expect(accepts(withField({ target: false, modelMayWrite: true }))).toBe(
        false,
      );
    });
  });

  describe("builder operations", () => {
    it("serve agent nodes only, and agent nodes use the builder implementation", () => {
      expect(accepts({ ...builderStart, nodeKinds: ["agent", "lookup"] })).toBe(
        false,
      );
      expect(accepts({ ...builderStart, nodeKinds: ["action"] })).toBe(false);
      expect(
        accepts({
          ...action,
          implementation: { type: "builder", op: "start" },
        }),
      ).toBe(false);
      expect(
        accepts({
          ...builderStart,
          implementation: { type: "action", action: "x" },
        }),
      ).toBe(false);
    });

    it("read for check and write for start and followUp", () => {
      const check = {
        ...builderStart,
        id: "builder.check",
        effect: "read",
        implementation: { type: "builder", op: "check" },
      };
      expect(accepts(check)).toBe(true);
      expect(accepts({ ...check, effect: "write" })).toBe(false);
      expect(accepts({ ...builderStart, effect: "read" })).toBe(false);
      expect(
        accepts({
          ...builderStart,
          id: "builder.followUp",
          implementation: { type: "builder", op: "followUp" },
        }),
      ).toBe(true);
    });
  });

  it("accepts every operation in the catalog", () => {
    expect(OPERATION_DEFINITIONS.length).toBeGreaterThan(30);
    for (const definition of OPERATION_DEFINITIONS) {
      expect(accepts(definition), definition.id).toBe(true);
    }
  });
});

describe("isWriteAllowedForNode", () => {
  const parse = (definition: OperationDefinitionInput) =>
    operationDefinitionSchema.parse(definition);

  it("lets a write run only on an action or agent node it declares", () => {
    expect(isWriteAllowedForNode(parse(action), "action")).toBe(true);
    expect(isWriteAllowedForNode(parse(builderStart), "agent")).toBe(true);
    expect(isWriteAllowedForNode(parse(action), "lookup")).toBe(false);
    expect(isWriteAllowedForNode(parse(action), "source")).toBe(false);
  });

  it("lets a read run wherever it declares it can", () => {
    expect(isWriteAllowedForNode(parse(lookup), "lookup")).toBe(true);
    expect(isWriteAllowedForNode(parse(source), "source")).toBe(true);
  });

  it("refuses a node kind the operation does not declare", () => {
    expect(isWriteAllowedForNode(parse(lookup), "source")).toBe(false);
    expect(isWriteAllowedForNode(parse(lookup), "action")).toBe(false);
    expect(isWriteAllowedForNode(parse(action), "agent")).toBe(false);
  });
});

describe("createOperationRegistry", () => {
  it("registers, gets and lists operations in the order registered", () => {
    const registry = createOperationRegistry();
    const registered = registry.register(lookup);
    registry.register(action);
    expect(registered.id).toBe("pylon.ticketThread");
    expect(registry.get("pylon.reply")?.label).toBe(
      "Pylon: reply to the customer",
    );
    expect(registry.list().map((definition) => definition.id)).toEqual([
      "pylon.ticketThread",
      "pylon.reply",
    ]);
  });

  it("returns undefined for an operation it does not have", () => {
    expect(createOperationRegistry().get("pylon.reply")).toBeUndefined();
  });

  it("rejects a second operation with the same id and keeps the first", () => {
    const registry = createOperationRegistry();
    registry.register(lookup);
    let caught: unknown;
    try {
      registry.register({ ...lookup, label: "A different label" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OperationRegistryError);
    expect(caught).toMatchObject({
      code: "duplicate_operation",
      operationId: "pylon.ticketThread",
    });
    expect(registry.list()).toHaveLength(1);
    expect(registry.get("pylon.ticketThread")?.label).toBe(lookup.label);
  });

  it("refuses an invalid definition instead of storing it", () => {
    const registry = createOperationRegistry();
    expect(() => registry.register({ ...lookup, effect: "write" })).toThrow();
    expect(registry.list()).toEqual([]);
  });

  it("hands out a list a caller cannot use to change the registry", () => {
    const registry = createOperationRegistry();
    registry.register(lookup);
    registry.list().pop();
    expect(registry.list()).toHaveLength(1);
  });

  it("serves as the catalog graph validation checks against", () => {
    expect(
      validateWorkflowGraph(
        STORY_GRAPHS["bug-report-to-builder"],
        buildOperationCatalog(),
      ),
    ).toEqual({ ok: true, issues: [] });
    expect(
      validateWorkflowGraph(
        STORY_GRAPHS["builder-to-merge"],
        createOperationRegistry(),
      )
        .issues.map((issue) => issue.code)
        .includes("unknown_operation"),
    ).toBe(true);
  });
});
