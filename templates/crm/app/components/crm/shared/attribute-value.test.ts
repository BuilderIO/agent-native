import { describe, expect, it } from "vitest";

import { CRM_ATTRIBUTE_TYPES } from "../../../../shared/crm-attributes";
import {
  assertValueRegistryComplete,
  ATTRIBUTE_VALUE_SPECS,
  attributeInputValue,
  currencyCodeOf,
  parseAttributeValue,
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

describe("currencyCodeOf", () => {
  it("normalises a lowercase code and rejects a non-code", () => {
    expect(currencyCodeOf({ currency: { code: "eur" } })).toBe("EUR");
    expect(currencyCodeOf({ currency: { code: "dollars" } })).toBeNull();
    expect(currencyCodeOf(undefined)).toBeNull();
  });
});
