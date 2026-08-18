import { describe, expect, it } from "vitest";

import { CRM_ATTRIBUTE_TYPES } from "../../../../shared/crm-attributes";
import {
  assertValueRegistryComplete,
  ATTRIBUTE_VALUE_SPECS,
  attributeInputValue,
  currencyCodeOf,
  editorDraftFor,
  editorInputType,
  parseAttributeValue,
  referenceMembers,
  referenceSearchKind,
  toggleReferenceValue,
  valueTokens,
  type CrmValueShape,
} from "./attribute-value";

function attribute(overrides: Partial<CrmValueShape> = {}): CrmValueShape {
  return { attributeType: "text", multi: false, ...overrides };
}

describe("the shared registry", () => {
  it("covers every attribute type once", () => {
    expect(Object.keys(ATTRIBUTE_VALUE_SPECS).sort()).toEqual(
      [...CRM_ATTRIBUTE_TYPES].sort(),
    );
    expect(() => assertValueRegistryComplete()).not.toThrow();
  });
});

describe("editor seeds round-trip through the parser", () => {
  // The regression this collapse exists to prevent: the grid used to seed its
  // editor with the *formatted* value, so opening a currency cell and pressing
  // Enter failed as "not a number" while the record panel was fine.
  it("re-parses a formatted currency amount", () => {
    const currency = attribute({
      attributeType: "currency",
      config: { currency: { code: "usd" } },
    });
    const seed = attributeInputValue(currency, 1200);
    expect(seed).toBe("1200");
    expect(parseAttributeValue(currency, seed)).toEqual({
      ok: true,
      value: 1200,
    });
  });

  it("re-parses a stored timestamp held in a date attribute", () => {
    const date = attribute({ attributeType: "date" });
    const seed = attributeInputValue(date, "2026-03-04T11:30:00.000Z");
    expect(seed).toBe("2026-03-04");
    expect(parseAttributeValue(date, seed)).toEqual({
      ok: true,
      value: "2026-03-04",
    });
  });
});

describe("managed options", () => {
  const status = attribute({
    attributeType: "status",
    options: [
      { id: "o1", value: "won", title: "Won", position: 0, archived: false },
      {
        id: "o2",
        value: "stale",
        title: "Stale",
        position: 1,
        archived: true,
      },
    ],
  });

  it("refuses an archived option — the writer resolves live options only", () => {
    expect(parseAttributeValue(status, "stale")).toEqual({
      ok: false,
      reason: "unknown-option",
      detail: "stale",
    });
  });

  it("still labels a value whose option was archived after it was written", () => {
    expect(valueTokens(status, "stale")).toEqual([{ label: "Stale" }]);
  });

  it("keeps an unknown value visible rather than blanking it", () => {
    expect(valueTokens(status, "mystery")).toEqual([{ label: "mystery" }]);
  });
});

describe("inline editor drafts", () => {
  // The regression: the record panel re-seeded its draft from the `attribute`
  // object, which its callers rebuild on every render. The reset landed
  // mid-edit, the browser dropped the selection, and a select-all-and-retype
  // of "Won" over "Negotiation" stored the literal value "WonNegotiation".
  it("replaces a selected value rather than interleaving with it", () => {
    const stage = attribute();
    let state = editorDraftFor(
      undefined,
      attributeInputValue(stage, "Negotiation"),
    );
    expect(state.draft).toBe("Negotiation");

    // Select all, retype.
    state = { ...state, draft: "Won" };

    // A re-render with a brand new attribute object and the same committed
    // value must leave the in-progress draft alone.
    state = editorDraftFor(
      state,
      attributeInputValue(attribute(), "Negotiation"),
    );
    expect(state.draft).toBe("Won");

    expect(parseAttributeValue(stage, state.draft)).toEqual({
      ok: true,
      value: "Won",
    });
  });

  it("re-seeds when the committed value itself changes", () => {
    const stage = attribute();
    const typed = { ...editorDraftFor(undefined, "Negotiation"), draft: "Won" };
    expect(
      editorDraftFor(typed, attributeInputValue(stage, "Closed Lost")).draft,
    ).toBe("Closed Lost");
  });

  it("seeds from the raw value, not the formatted one", () => {
    const amount = attribute({
      attributeType: "currency",
      config: { currency: { code: "usd" } },
    });
    expect(
      editorDraftFor(undefined, attributeInputValue(amount, 184000)),
    ).toEqual({ draft: "184000", seed: "184000" });
  });
});

describe("editorInputType", () => {
  // The regression, reproduced in a browser and confirmed in SQL: the record
  // panel rendered `amount` as <input type="number">. Mid-typing "91e" the
  // control reports value "" with validity.badInput, the parser read "" as
  // "cleared", and Enter stored amount = NULL for a value the user had typed.
  it("never renders a numeric attribute as type=number", () => {
    for (const attributeType of ["number", "currency", "rating"] as const) {
      expect(editorInputType(attribute({ attributeType }))).toEqual({
        type: "text",
        inputMode: "decimal",
      });
    }
  });

  it("keeps the native control for dates and typed text", () => {
    expect(editorInputType(attribute({ attributeType: "date" }))).toEqual({
      type: "date",
    });
    expect(
      editorInputType(attribute({ attributeType: "email-address" })),
    ).toEqual({ type: "email" });
  });

  it("falls back to text for a multi value, which is a comma-separated list", () => {
    expect(
      editorInputType(attribute({ attributeType: "date", multi: true })),
    ).toEqual({ type: "text" });
  });
});

describe("reference values", () => {
  const reference = attribute({ attributeType: "record-reference" });

  it("narrows the picker only when exactly one known object type is declared", () => {
    expect(referenceSearchKind(reference)).toBeNull();
    expect(
      referenceSearchKind(
        attribute({
          attributeType: "record-reference",
          config: { reference: { allowedObjectTypes: ["accounts"] } },
        }),
      ),
    ).toBe("account");
    // Two allowed types cannot be expressed as one `kind`; narrowing to the
    // first would hide exactly the record the user is searching for.
    expect(
      referenceSearchKind(
        attribute({
          attributeType: "record-reference",
          config: {
            reference: { allowedObjectTypes: ["accounts", "people"] },
          },
        }),
      ),
    ).toBeNull();
    expect(
      referenceSearchKind(
        attribute({
          attributeType: "record-reference",
          config: { reference: { allowedObjectTypes: ["widgets"] } },
        }),
      ),
    ).toBeNull();
  });

  it("replaces a single reference and toggles a multi one", () => {
    expect(toggleReferenceValue("Acme Freight", "Cedarline", false)).toBe(
      "Cedarline",
    );
    expect(toggleReferenceValue(null, "Acme Freight", true)).toEqual([
      "Acme Freight",
    ]);
    expect(toggleReferenceValue(["Acme Freight"], "Cedarline", true)).toEqual([
      "Acme Freight",
      "Cedarline",
    ]);
    expect(
      toggleReferenceValue(["Acme Freight", "Cedarline"], "Cedarline", true),
    ).toEqual(["Acme Freight"]);
  });

  it("clears to null, never to an empty array", () => {
    expect(toggleReferenceValue(["Acme Freight"], "Acme Freight", true)).toBe(
      null,
    );
  });

  it("reads members off both shapes and drops non-string debris", () => {
    expect(referenceMembers(undefined)).toEqual([]);
    expect(referenceMembers("Acme Freight")).toEqual(["Acme Freight"]);
    expect(referenceMembers(["Acme Freight", "", 7])).toEqual(["Acme Freight"]);
  });
});

describe("currencyCodeOf", () => {
  it("normalises a lowercase code and rejects a non-code", () => {
    expect(currencyCodeOf({ currency: { code: "eur" } })).toBe("EUR");
    expect(currencyCodeOf({ currency: { code: "dollars" } })).toBeNull();
    expect(currencyCodeOf(undefined)).toBeNull();
  });
});
