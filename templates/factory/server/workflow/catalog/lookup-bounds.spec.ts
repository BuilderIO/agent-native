import { describe, expect, it } from "vitest";

import {
  operationDefinitionSchema,
  type OperationDefinition,
  type OperationDefinitionInput,
} from "../operations.js";
import { OPERATION_CATALOG } from "./index.js";

// One step hands on about 64 KB in all, summed over every item it emits and
// every earlier answer still attached to each, so a lookup that returns a
// provider's own JSON needs a ceiling or one busy record fills a step. A lookup
// whose answer is one small record by id may go without one, and says why here.
const FINE_UNBOUNDED: Record<string, string> = {
  "hubspot.companyActivity":
    "one contact by id with a fixed list of properties: about 1.5 KB, and only a contact with hundreds of associated companies grows it",
  "hubspot.ownerById":
    "one owner record by id: under 1 KB, and under 3 KB for an owner on twenty teams",
  "slack.findUserByEmail":
    "one Slack user: about 2 KB, almost all of it the profile's image links",
};

// The host actions that cut what they return to a `budgetChars` input. A budget
// on a lookup that calls any other action would be dropped by its input schema.
const ACTIONS_THAT_TAKE_A_BUDGET = ["list-factory-items", "read-slack-thread"];

// The host actions that keep only the `items.` paths they are given. An action
// that did not would drop them and hand on every field.
const ACTIONS_THAT_TAKE_ANSWER_FIELDS = ["list-factory-items"];

/**
 * A lookup read that hands on whatever JSON its provider or host action
 * answered: not a source (its rows are mapped), not the API request (its
 * Fields to keep and its own paging bound the answer a person asked for).
 */
function isArbitraryLookup(def: OperationDefinition): boolean {
  return (
    def.effect === "read" &&
    def.nodeKinds.includes("lookup") &&
    def.itemMapping === undefined &&
    !(
      def.implementation.type === "provider-request" &&
      def.implementation.freeForm !== undefined
    )
  );
}

/**
 * The ones with no ceiling: no answer budget and, for a host action (which
 * shapes and limits its own answer), no declared outputs either. An `outputs`
 * list on a provider request names what a graph may read and cuts nothing, so
 * it does not count there.
 */
function unboundedLookups(defs: readonly OperationDefinition[]): string[] {
  return defs
    .filter(isArbitraryLookup)
    .filter(
      (def) =>
        def.answerBudgetChars === undefined &&
        !(def.implementation.type === "action" && def.outputs !== undefined),
    )
    .map((def) => def.id);
}

const lookup: OperationDefinitionInput = {
  id: "acme.thing",
  provider: "acme",
  label: "Acme: read a thing",
  nodeKinds: ["lookup"],
  effect: "read",
  fields: [{ name: "id", type: "string", required: true }],
  implementation: {
    type: "provider-request",
    method: "GET",
    pathTemplate: "/things/{id}",
  },
  credential: { provider: "acme" },
};

const parse = (input: OperationDefinitionInput): OperationDefinition =>
  operationDefinitionSchema.parse(input);
const accepts = (input: unknown) =>
  operationDefinitionSchema.safeParse(input).success;

describe("the lookups that hand on a provider's own JSON", () => {
  const defs = OPERATION_CATALOG.list();

  it("each declare an answer budget, or an action's outputs, or say here why they need none", () => {
    expect(unboundedLookups(defs).sort()).toEqual(
      Object.keys(FINE_UNBOUNDED).sort(),
    );
  });

  it("keep the list of unbounded ones honest: each is such a lookup, has a reason, and has no bound to list", () => {
    for (const [id, reason] of Object.entries(FINE_UNBOUNDED)) {
      const def = OPERATION_CATALOG.get(id);
      expect(def, id).toBeDefined();
      expect(isArbitraryLookup(def!), id).toBe(true);
      expect(reason.length, id).toBeGreaterThan(20);
      expect(def!.answerBudgetChars, `${id} has a budget after all`).toBe(
        undefined,
      );
    }
  });

  it("refuse a new one with no ceiling, and accept it once it has one", () => {
    expect(unboundedLookups([parse(lookup)])).toEqual(["acme.thing"]);
    expect(
      unboundedLookups([parse({ ...lookup, answerBudgetChars: 5_000 })]),
    ).toEqual([]);
    // A provider request's `outputs` cut nothing, so they are no ceiling.
    expect(
      unboundedLookups([
        parse({ ...lookup, outputs: [{ name: "id", type: "string" }] }),
      ]),
    ).toEqual(["acme.thing"]);
    const action: OperationDefinitionInput = {
      ...lookup,
      implementation: { type: "action", action: "read-thing" },
    };
    expect(unboundedLookups([parse(action)])).toEqual(["acme.thing"]);
    expect(
      unboundedLookups([
        parse({ ...action, outputs: [{ name: "id", type: "string" }] }),
      ]),
    ).toEqual([]);
  });

  it("leave a source, an API request and a write out of the rule", () => {
    const mapped: OperationDefinitionInput = {
      ...lookup,
      id: "acme.newThings",
      nodeKinds: ["source"],
      itemMapping: {
        kind: "issue",
        fields: { title: "title", occurredAt: "created" },
        dedupeKey: "id",
      },
    };
    expect(unboundedLookups([parse(mapped)])).toEqual([]);
    const api = OPERATION_CATALOG.get("github.apiRequest")!;
    expect(isArbitraryLookup(api)).toBe(false);
    expect(
      unboundedLookups(defs.filter((def) => def.effect === "write")),
    ).toEqual([]);
  });

  it("pass a budget only to a host action that takes one", () => {
    const withBudget = defs.filter(
      (def) =>
        def.implementation.type === "action" &&
        def.answerBudgetChars !== undefined,
    );

    expect(withBudget.map((def) => def.id).sort()).toEqual([
      "factory.listItems",
      "slack.readThread",
    ]);
    for (const def of withBudget) {
      expect(ACTIONS_THAT_TAKE_A_BUDGET, def.id).toContain(
        def.implementation.type === "action" ? def.implementation.action : "",
      );
    }
  });

  it("keep fields only where they cut an answer that is also bounded", () => {
    const kept = defs.filter((def) => def.answerFields !== undefined);

    expect(kept.map((def) => def.id).sort()).toEqual([
      "factory.listItems",
      "github.mergedPullRequests",
      "github.searchCode",
      "gong.transcript",
      "posthog.usage",
      "stripe.customerBilling",
    ]);
    for (const def of kept) {
      expect(def.answerBudgetChars, def.id).toBeDefined();
    }
  });

  it("pass fields to keep only to a host action that takes them, and only under items.", () => {
    const keptByAction = defs.filter(
      (def) =>
        def.implementation.type === "action" && def.answerFields !== undefined,
    );

    expect(keptByAction.map((def) => def.id)).toEqual(["factory.listItems"]);
    for (const def of keptByAction) {
      expect(ACTIONS_THAT_TAKE_ANSWER_FIELDS, def.id).toContain(
        def.implementation.type === "action" ? def.implementation.action : "",
      );
      for (const path of def.answerFields ?? []) {
        expect(path.startsWith("items."), `${def.id} ${path}`).toBe(true);
      }
    }
  });
});

describe("answerFields", () => {
  it("is declared by a provider-request lookup read with a fixed endpoint", () => {
    expect(accepts({ ...lookup, answerFields: ["id", "owner.login"] })).toBe(
      true,
    );
  });

  it("is declared by a lookup read that calls a host action", () => {
    expect(
      accepts({
        ...lookup,
        implementation: { type: "action", action: "read-thing" },
        answerFields: ["items.id"],
      }),
    ).toBe(true);
  });

  it("is refused on a source, a write and the open endpoint", () => {
    expect(
      accepts({
        ...lookup,
        nodeKinds: ["source"],
        itemMapping: {
          kind: "issue",
          fields: { title: "title", occurredAt: "created" },
          dedupeKey: "id",
        },
        answerFields: ["id"],
      }),
    ).toBe(false);
    expect(
      accepts({
        ...lookup,
        nodeKinds: ["action"],
        effect: "write",
        implementation: { ...lookup.implementation, method: "POST" },
        receipt: { externalRef: "id" },
        answerFields: ["id"],
      }),
    ).toBe(false);
    expect(
      accepts({
        ...lookup,
        nodeKinds: ["action"],
        effect: "write",
        implementation: { type: "action", action: "write-thing" },
        receipt: { externalRef: "id" },
        answerFields: ["items.id"],
      }),
    ).toBe(false);
    const open = OPERATION_CATALOG.get("github.apiRequest")!;
    expect(accepts({ ...open, answerFields: ["id"] })).toBe(false);
  });

  it("holds paths that Fields to keep would take, and no others", () => {
    expect(accepts({ ...lookup, answerFields: [] })).toBe(false);
    expect(accepts({ ...lookup, answerFields: ["id", "id"] })).toBe(false);
    expect(accepts({ ...lookup, answerFields: ["a..b"] })).toBe(false);
    expect(accepts({ ...lookup, answerFields: ["__proto__"] })).toBe(false);
    expect(accepts({ ...lookup, answerFields: [1] })).toBe(false);
    expect(
      accepts({
        ...lookup,
        answerFields: Array.from({ length: 51 }, (_, index) => `f${index}`),
      }),
    ).toBe(false);
    expect(accepts({ ...lookup, answerFields: ["a.b.c.d.e.f.g.h.i"] })).toBe(
      false,
    );
  });
});
