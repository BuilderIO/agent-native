import { describe, expect, it } from "vitest";

import type { CrmAttributeDefinition } from "../../../../shared/crm-contract";
import {
  applyEntryValue,
  applyFieldValue,
  entryAttributeAsEditable,
  fieldEditability,
  fieldInputValue,
  formatFieldValue,
  historyTransitions,
  isSuppressedDuplicateAttribute,
  parseFieldInput,
  resolveActivityState,
  rollbackEntryValue,
  rollbackFieldValue,
  splitHighlights,
  withoutSuppressedDuplicates,
  type CrmRecordPage,
} from "./record-data";

function attribute(
  overrides: Partial<CrmAttributeDefinition> = {},
): CrmAttributeDefinition {
  return {
    id: "attr_1",
    connectionId: "conn",
    target: "object",
    targetId: "companies",
    apiSlug: "renewal_stage",
    label: "Renewal stage",
    attributeType: "text",
    multi: false,
    authority: "local-authoritative",
    historyTracked: true,
    uniqueValue: false,
    archived: false,
    position: 0,
    inverseAttributeId: null,
    fillMode: null,
    fillConfig: {},
    config: {},
    options: [],
    storagePolicy: "local-authoritative",
    sensitive: false,
    readable: true,
    createable: true,
    updateable: true,
    required: false,
    ...overrides,
  };
}

function page(overrides: Partial<CrmRecordPage> = {}): CrmRecordPage {
  return {
    record: {
      id: "rec_1",
      connectionId: "conn",
      provider: "native",
      objectType: "companies",
      kind: "account",
      displayName: "Acme",
      remoteRevision: "1",
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
    attributes: [],
    values: {},
    valueMeta: {},
    lists: [],
    listMembershipsTruncated: false,
    recordUrl: null,
    recordUrlUnavailableReason: null,
    ...overrides,
  };
}

describe("fieldEditability", () => {
  it("allows a local-authoritative updateable attribute of a supported type", () => {
    expect(fieldEditability(attribute())).toEqual({ editable: true });
  });

  it("names why a provider-owned field is locked instead of failing silently", () => {
    expect(fieldEditability(attribute({ storagePolicy: "mirrored" }))).toEqual({
      editable: false,
      reason: "provider-owned",
    });
  });

  it("locks a redacted field ahead of every other reason", () => {
    expect(
      fieldEditability(
        attribute({ storagePolicy: "redacted", updateable: false }),
      ),
    ).toEqual({ editable: false, reason: "redacted" });
  });

  it("locks types this panel has no editor for", () => {
    expect(fieldEditability(attribute({ attributeType: "location" }))).toEqual({
      editable: false,
      reason: "unsupported-type",
    });
  });

  it("allows a record reference now that the panel has a picker", () => {
    expect(
      fieldEditability(attribute({ attributeType: "record-reference" })),
    ).toEqual({ editable: true });
  });
});

describe("parseFieldInput", () => {
  it("returns a typed failure for a non-numeric number", () => {
    expect(
      parseFieldInput(attribute({ attributeType: "number" }), "twelve"),
    ).toEqual({ ok: false, code: "not-a-number" });
  });

  it("clears a value with empty input rather than storing an empty string", () => {
    expect(parseFieldInput(attribute(), "   ")).toEqual({
      ok: true,
      value: null,
    });
  });

  it("refuses an option the attribute does not declare", () => {
    const status = attribute({
      attributeType: "status",
      options: [
        { id: "o1", value: "won", title: "Won", position: 0, archived: false },
      ],
    });
    expect(parseFieldInput(status, "lost")).toEqual({
      ok: false,
      code: "unknown-option",
    });
    expect(parseFieldInput(status, "won")).toEqual({ ok: true, value: "won" });
  });

  it("splits a multi attribute on commas", () => {
    expect(
      parseFieldInput(
        attribute({ attributeType: "domain", multi: true }),
        "acme.com, acme.co.uk",
      ),
    ).toEqual({ ok: true, value: ["acme.com", "acme.co.uk"] });
  });

  it("refuses to parse input for an attribute the action would reject", () => {
    expect(
      parseFieldInput(attribute({ storagePolicy: "mirrored" }), "x"),
    ).toEqual({ ok: false, code: "not-editable" });
  });
});

describe("formatFieldValue", () => {
  it("keeps absent and empty-string distinct from a false checkbox", () => {
    const checkbox = attribute({ attributeType: "checkbox" });
    expect(formatFieldValue(checkbox, undefined)).toEqual({ kind: "empty" });
    expect(formatFieldValue(checkbox, false)).toEqual({
      kind: "boolean",
      value: false,
    });
  });

  it("renders an option by its title and colour", () => {
    const status = attribute({
      attributeType: "status",
      options: [
        {
          id: "o1",
          value: "won",
          title: "Closed won",
          color: "#0a0",
          position: 0,
          archived: false,
        },
      ],
    });
    expect(formatFieldValue(status, "won")).toEqual({
      kind: "tokens",
      tokens: [{ label: "Closed won", color: "#0a0" }],
    });
  });

  it("falls back to the raw value when no option declares it", () => {
    expect(
      formatFieldValue(attribute({ attributeType: "status" }), "mystery"),
    ).toEqual({ kind: "tokens", tokens: [{ label: "mystery" }] });
  });

  it("shows a currency amount with its configured code", () => {
    const currency = attribute({
      attributeType: "currency",
      config: { currency: { code: "USD" } },
    });
    const display = formatFieldValue(currency, 1200);
    expect(display.kind).toBe("text");
    expect(display.kind === "text" && display.text).toContain("1,200");
  });
});

describe("fieldInputValue", () => {
  it("round-trips a multi value through the comma editor", () => {
    const multi = attribute({ attributeType: "domain", multi: true });
    const text = fieldInputValue(multi, ["a.com", "b.com"]);
    expect(text).toBe("a.com, b.com");
    expect(parseFieldInput(multi, text)).toEqual({
      ok: true,
      value: ["a.com", "b.com"],
    });
  });
});

describe("splitHighlights", () => {
  it("pins the first six attributes by position when no kind is curated", () => {
    const attributes = Array.from({ length: 9 }, (_, index) =>
      attribute({ id: `a${index}`, position: 9 - index }),
    );
    const { highlights, rest } = splitHighlights(attributes);
    expect(highlights).toHaveLength(6);
    expect(rest).toHaveLength(3);
    expect(highlights[0]!.position).toBe(1);
  });

  it("falls back to position order for a custom kind", () => {
    const attributes = [
      attribute({ id: "a1", apiSlug: "one", position: 2 }),
      attribute({ id: "a2", apiSlug: "two", position: 0 }),
      attribute({ id: "a3", apiSlug: "three", position: 1 }),
    ];
    const { highlights } = splitHighlights(attributes, { kind: "custom" });
    expect(highlights.map((a) => a.apiSlug)).toEqual(["two", "three", "one"]);
  });

  it("curates a per-kind order, skipping an attribute the schema lacks", () => {
    const attributes = [
      attribute({ id: "a_name", apiSlug: "name", position: 0 }),
      attribute({ id: "a_domain", apiSlug: "domain", position: 1 }),
      attribute({ id: "a_industry", apiSlug: "industry", position: 2 }),
      attribute({ id: "a_owner", apiSlug: "ownerName", position: 3 }),
      // No `nextContactAt` attribute on this schema.
      attribute({ id: "a_extra", apiSlug: "desiredCadenceDays", position: 4 }),
    ];
    const { highlights, rest } = splitHighlights(attributes, {
      kind: "account",
    });
    expect(highlights.map((a) => a.apiSlug)).toEqual([
      "name",
      "domain",
      "industry",
      "ownerName",
      "desiredCadenceDays",
    ]);
    expect(rest).toHaveLength(0);
  });

  it("falls back to first+last name for a person schema with no name attribute", () => {
    const attributes = [
      attribute({ id: "p1", apiSlug: "firstName", position: 0 }),
      attribute({ id: "p2", apiSlug: "lastName", position: 1 }),
      attribute({ id: "p3", apiSlug: "email", position: 2 }),
      attribute({ id: "p4", apiSlug: "title", position: 3 }),
      attribute({ id: "p5", apiSlug: "accountId", position: 4 }),
      attribute({ id: "p6", apiSlug: "ownerName", position: 5 }),
    ];
    const { highlights, rest } = splitHighlights(attributes, {
      kind: "person",
    });
    expect(highlights.map((a) => a.apiSlug)).toEqual([
      "firstName",
      "lastName",
      "email",
      "title",
      "accountId",
      "ownerName",
    ]);
    expect(rest).toHaveLength(0);
  });

  it("backfills a short curated set with a valued attribute over an empty one", () => {
    const attributes = [
      attribute({ id: "a_name", apiSlug: "name", position: 0 }),
      attribute({ id: "a_amount", apiSlug: "amount", position: 1 }),
      attribute({ id: "a_stage", apiSlug: "stage", position: 2 }),
      attribute({ id: "a_close", apiSlug: "closeDate", position: 3 }),
      attribute({ id: "a_owner", apiSlug: "ownerName", position: 4 }),
      attribute({ id: "a_empty", apiSlug: "region", position: 5 }),
      attribute({ id: "a_filled", apiSlug: "sourceChannel", position: 6 }),
    ];
    const { highlights } = splitHighlights(attributes, {
      kind: "opportunity",
      values: { sourceChannel: "referral" }, // `region` has no value
    });
    expect(highlights.map((a) => a.apiSlug)).toEqual([
      "name",
      "amount",
      "stage",
      "closeDate",
      "ownerName",
      "sourceChannel",
    ]);
  });
});

describe("isSuppressedDuplicateAttribute", () => {
  it("suppresses displayName when it matches an existing name value", () => {
    expect(
      isSuppressedDuplicateAttribute("displayName", {
        name: "Acme",
        displayName: "Acme",
      }),
    ).toBe(true);
  });

  it("keeps displayName visible when name is absent", () => {
    expect(
      isSuppressedDuplicateAttribute("displayName", { displayName: "Acme" }),
    ).toBe(false);
  });

  it("keeps displayName visible when name was explicitly cleared", () => {
    expect(
      isSuppressedDuplicateAttribute("displayName", {
        name: null,
        displayName: "Acme",
      }),
    ).toBe(false);
  });

  it("keeps displayName visible when it diverges from name", () => {
    expect(
      isSuppressedDuplicateAttribute("displayName", {
        name: "Acme",
        displayName: "Acme Corp",
      }),
    ).toBe(false);
  });

  it("never suppresses an attribute other than displayName", () => {
    expect(
      isSuppressedDuplicateAttribute("name", {
        name: "Acme",
        displayName: "Acme",
      }),
    ).toBe(false);
  });
});

describe("withoutSuppressedDuplicates", () => {
  it("drops only the duplicate displayName row", () => {
    const attributes = [
      attribute({ id: "a1", apiSlug: "name" }),
      attribute({ id: "a2", apiSlug: "displayName" }),
    ];
    const kept = withoutSuppressedDuplicates(attributes, {
      name: "Acme",
      displayName: "Acme",
    });
    expect(kept.map((a) => a.apiSlug)).toEqual(["name"]);
  });

  it("keeps both rows when name is absent", () => {
    const attributes = [
      attribute({ id: "a1", apiSlug: "name" }),
      attribute({ id: "a2", apiSlug: "displayName" }),
    ];
    const kept = withoutSuppressedDuplicates(attributes, {
      displayName: "Acme",
    });
    expect(kept.map((a) => a.apiSlug)).toEqual(["name", "displayName"]);
  });
});

describe("historyTransitions", () => {
  it("reads bitemporal rows as from -> to, newest first", () => {
    const transitions = historyTransitions([
      {
        id: "f3",
        value: "Renewal",
        activeFrom: "2026-07-03T00:00:00.000Z",
        activeUntil: null,
        current: true,
        actorType: "user",
        actorId: "sam@example.test",
      },
      {
        id: "f2",
        value: "Negotiation",
        activeFrom: "2026-07-02T00:00:00.000Z",
        activeUntil: "2026-07-03T00:00:00.000Z",
        current: false,
        actorType: "agent",
        actorId: null,
      },
      {
        id: "f1",
        value: "Discovery",
        activeFrom: "2026-07-01T00:00:00.000Z",
        activeUntil: "2026-07-02T00:00:00.000Z",
        current: false,
        actorType: "system",
        actorId: null,
      },
    ]);
    expect(transitions[0]).toMatchObject({
      from: "Negotiation",
      to: "Renewal",
      actorId: "sam@example.test",
    });
    expect(transitions[1]).toMatchObject({
      from: "Discovery",
      to: "Negotiation",
    });
    // The first value ever written has no predecessor. `undefined`, not `null`:
    // `null` is a real stored value meaning the field was cleared.
    expect(transitions[2]!.from).toBeUndefined();
  });
});

describe("resolveActivityState", () => {
  it("reports an empty feed as not-ingested rather than as no activity", () => {
    expect(resolveActivityState([])).toEqual({ kind: "not-ingested" });
    expect(resolveActivityState(undefined)).toEqual({ kind: "not-ingested" });
  });

  it("reports real interactions as items", () => {
    expect(resolveActivityState([{ id: "i1", title: "Kickoff call" }])).toEqual(
      { kind: "items", items: [{ id: "i1", title: "Kickoff call" }] },
    );
  });
});

describe("optimistic field edits", () => {
  it("applies a value and rolls back to no value at all", () => {
    const before = page();
    const { page: after, edit } = applyFieldValue(
      before,
      "renewal_stage",
      "Renewal",
      { since: "2026-07-04T00:00:00.000Z", actorType: "user", actorId: null },
    );
    expect(after.values.renewal_stage).toBe("Renewal");
    const restored = rollbackFieldValue(after, edit);
    expect("renewal_stage" in restored.values).toBe(false);
    expect("renewal_stage" in restored.valueMeta).toBe(false);
    expect(before.values).toEqual({});
  });

  it("rolls back to the previous value when one existed", () => {
    const before = page({
      values: { renewal_stage: "Discovery" },
      valueMeta: {
        renewal_stage: {
          since: "2026-07-01T00:00:00.000Z",
          actorType: "system",
          actorId: null,
        },
      },
    });
    const { page: after, edit } = applyFieldValue(
      before,
      "renewal_stage",
      "Renewal",
      { since: "2026-07-04T00:00:00.000Z", actorType: "user", actorId: null },
    );
    const restored = rollbackFieldValue(after, edit);
    expect(restored.values.renewal_stage).toBe("Discovery");
    expect(restored.valueMeta.renewal_stage?.actorType).toBe("system");
  });

  it("edits one entry of a list without touching the record's other entry", () => {
    const listed = page({
      lists: [
        {
          id: "list_1",
          name: "Renewals",
          apiSlug: "renewals",
          parentObjectType: "companies",
          attributes: [],
          entries: [
            {
              id: "entry_a",
              listId: "list_1",
              recordId: "rec_1",
              position: 0,
              createdAt: "2026-07-01T00:00:00.000Z",
              createdByActorType: "user",
              createdByActorId: null,
              values: { stage: "new" },
              valuesSince: {},
            },
            {
              id: "entry_b",
              listId: "list_1",
              recordId: "rec_1",
              position: 1,
              createdAt: "2026-07-01T00:00:00.000Z",
              createdByActorType: "user",
              createdByActorId: null,
              values: { stage: "won" },
              valuesSince: {},
            },
          ],
        },
      ],
    });
    const { page: after, previousValue } = applyEntryValue(
      listed,
      "entry_a",
      "stage",
      "in-progress",
    );
    expect(after.lists[0]!.entries[0]!.values.stage).toBe("in-progress");
    expect(after.lists[0]!.entries[1]!.values.stage).toBe("won");
    const restored = rollbackEntryValue(
      after,
      "entry_a",
      "stage",
      previousValue,
    );
    expect(restored.lists[0]!.entries[0]!.values.stage).toBe("new");
  });
});

describe("entryAttributeAsEditable", () => {
  it("treats a list attribute as locally editable", () => {
    const editable = entryAttributeAsEditable({
      id: "la1",
      apiSlug: "stage",
      label: "Stage",
      description: null,
      attributeType: "status",
      multi: false,
      required: false,
      position: 0,
      usesOptions: true,
      options: [],
    });
    expect(fieldEditability(editable)).toEqual({ editable: true });
  });
});
