import { describe, expect, it } from "vitest";

import { CRM_ATTRIBUTE_TYPES } from "../../../../shared/crm-attributes";
import {
  assertCellRegistryComplete,
  CELL_SPECS,
  cellSpecFor,
  copyCell,
  formatCell,
  isCellEditable,
  isSuppressedDisplayNameCell,
  parseCell,
  parseCellProvenance,
  statusOverrunDays,
  type CrmGridAttribute,
} from "./model";

function attribute(
  overrides: Partial<CrmGridAttribute> = {},
): CrmGridAttribute {
  return {
    id: "attr-1",
    apiSlug: "field",
    label: "Field",
    attributeType: "text",
    multi: false,
    authority: "local-authoritative",
    storagePolicy: "local-authoritative",
    updateable: true,
    ...overrides,
  };
}

describe("cell registry", () => {
  it("covers every CRM attribute type", () => {
    expect(Object.keys(CELL_SPECS).sort()).toEqual(
      [...CRM_ATTRIBUTE_TYPES].sort(),
    );
    expect(CRM_ATTRIBUTE_TYPES).toHaveLength(17);
    expect(() => assertCellRegistryComplete()).not.toThrow();
  });

  it("gives every type a format that never throws on any stored shape", () => {
    const shapes = [null, "x", 12, true, ["a", "b"], { locality: "Oslo" }];
    for (const type of CRM_ATTRIBUTE_TYPES) {
      for (const value of shapes) {
        const attr = attribute({ attributeType: type });
        expect(typeof formatCell(attr, value as never)).toBe("string");
      }
    }
  });

  it("renders system-only and composite types read-only", () => {
    for (const type of ["interaction", "personal-name", "location"] as const) {
      expect(isCellEditable(attribute({ attributeType: type }))).toBe(false);
    }
  });

  it("demotes an attribute the caller cannot update to a read-only cell", () => {
    const attr = attribute({ attributeType: "text", updateable: false });
    expect(cellSpecFor(attr).editor).toBe("readonly");
    expect(parseCell(attr, "hello")).toEqual({
      ok: false,
      reason: "read-only",
    });
  });

  it("right-aligns the numeric types and centres checkbox", () => {
    expect(CELL_SPECS.number.align).toBe("right");
    expect(CELL_SPECS.currency.align).toBe("right");
    expect(CELL_SPECS.rating.align).toBe("right");
    expect(CELL_SPECS.checkbox.align).toBe("center");
  });
});

describe("parsing", () => {
  it("refuses a non-numeric value instead of storing NaN or zero", () => {
    const attr = attribute({ attributeType: "number" });
    expect(parseCell(attr, "12abc")).toEqual({
      ok: false,
      reason: "not-a-number",
      detail: "12abc",
    });
    expect(parseCell(attr, "")).toEqual({ ok: true, value: null });
    expect(parseCell(attr, "1,250")).toEqual({ ok: true, value: 1250 });
  });

  it("refuses an unknown managed option rather than auto-creating it", () => {
    const attr = attribute({
      attributeType: "status",
      options: [
        { id: "o1", value: "won", title: "Won", position: 0, archived: false },
      ],
    });
    expect(parseCell(attr, "Won")).toEqual({ ok: true, value: "won" });
    expect(parseCell(attr, "maybe")).toEqual({
      ok: false,
      reason: "unknown-option",
      detail: "maybe",
    });
  });

  it("fails a whole multi-valued cell rather than dropping a bad member", () => {
    const attr = attribute({
      attributeType: "select",
      multi: true,
      options: [
        { id: "o1", value: "a", title: "A", position: 0, archived: false },
        { id: "o2", value: "b", title: "B", position: 1, archived: false },
      ],
    });
    expect(parseCell(attr, "a, b")).toEqual({ ok: true, value: ["a", "b"] });
    expect(parseCell(attr, "a, zzz").ok).toBe(false);
  });

  it("rejects an unreadable date instead of coercing to the epoch", () => {
    const attr = attribute({ attributeType: "date" });
    expect(parseCell(attr, "2026-03-04")).toEqual({
      ok: true,
      value: "2026-03-04",
    });
    expect(parseCell(attr, "next tuesday").ok).toBe(false);
  });
});

describe("formatting", () => {
  it("formats currency from the attribute config and copies the raw amount", () => {
    const attr = attribute({
      attributeType: "currency",
      config: { currency: { code: "eur" } },
    });
    expect(formatCell(attr, 1200, "en-US")).toContain("1,200");
    expect(copyCell(attr, 1200)).toBe("1200");
  });

  it("falls back to the bare number when no currency code is configured", () => {
    const attr = attribute({ attributeType: "currency" });
    expect(formatCell(attr, 1200)).toBe("1200");
  });

  it("shows an option title but copies its value so a paste round-trips", () => {
    const attr = attribute({
      attributeType: "status",
      options: [
        {
          id: "o1",
          value: "in-progress",
          title: "In progress",
          position: 0,
          archived: false,
        },
      ],
    });
    expect(formatCell(attr, "in-progress")).toBe("In progress");
    expect(copyCell(attr, "in-progress")).toBe("in-progress");
    expect(parseCell(attr, copyCell(attr, "in-progress"))).toEqual({
      ok: true,
      value: "in-progress",
    });
  });

  it("joins multi-valued cells", () => {
    const attr = attribute({ attributeType: "email-address", multi: true });
    expect(formatCell(attr, ["a@x.com", "b@x.com"])).toBe("a@x.com, b@x.com");
  });
});

describe("status SLA", () => {
  const attr = attribute({
    attributeType: "status",
    options: [
      {
        id: "o1",
        value: "review",
        title: "Review",
        position: 0,
        archived: false,
        targetDays: 3,
      },
    ],
  });

  it("reports the overrun once the stage is past its target", () => {
    expect(
      statusOverrunDays({
        attribute: attr,
        value: "review",
        since: "2026-01-01T00:00:00.000Z",
        now: new Date("2026-01-06T00:00:00.000Z"),
      }),
    ).toBe(2);
  });

  it("reports nothing while inside the target", () => {
    expect(
      statusOverrunDays({
        attribute: attr,
        value: "review",
        since: "2026-01-01T00:00:00.000Z",
        now: new Date("2026-01-02T00:00:00.000Z"),
      }),
    ).toBeNull();
  });

  it("reports nothing — not on-time — when the stage age is unknown", () => {
    expect(
      statusOverrunDays({ attribute: attr, value: "review", since: undefined }),
    ).toBeNull();
  });
});

describe("provenance", () => {
  it("keeps an unreadable blob distinguishable from an absent one", () => {
    expect(
      parseCellProvenance({ actorType: "user", provenanceJson: "{not json" }),
    ).toEqual({ actorType: "user", actorId: null, readable: false });
    expect(
      parseCellProvenance({ actorType: "user", provenanceJson: "[]" }),
    ).toEqual({ actorType: "user", actorId: null, readable: true });
  });

  it("reads source, url, confidence, and reasoning when present", () => {
    const parsed = parseCellProvenance({
      actorType: "agent",
      actorId: "agent-7",
      fieldName: "stage",
      provenanceJson: JSON.stringify([
        {
          provider: "hubspot",
          fieldName: "stage",
          sourceUrl: "https://example.com/r/1",
          confidence: 0.82,
          reasoning: "Matched the renewal call summary.",
          observedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    });
    expect(parsed).toMatchObject({
      actorType: "agent",
      actorId: "agent-7",
      readable: true,
      source: "hubspot",
      sourceUrl: "https://example.com/r/1",
      confidence: 0.82,
      reasoning: "Matched the renewal call summary.",
    });
  });

  it("falls back to a known actor type for an unrecognised one", () => {
    expect(
      parseCellProvenance({ actorType: "martian", provenanceJson: null })
        .actorType,
    ).toBe("system");
  });
});

describe("isSuppressedDisplayNameCell", () => {
  it("suppresses displayName when it matches the row's name", () => {
    expect(
      isSuppressedDisplayNameCell("displayName", {
        name: "Acme",
        displayName: "Acme",
      }),
    ).toBe(true);
  });

  it("keeps displayName visible when the row has no name", () => {
    expect(
      isSuppressedDisplayNameCell("displayName", { displayName: "Acme" }),
    ).toBe(false);
  });

  it("keeps displayName visible when the values diverge", () => {
    expect(
      isSuppressedDisplayNameCell("displayName", {
        name: "Acme",
        displayName: "Acme, Inc.",
      }),
    ).toBe(false);
  });

  it("only applies to the displayName slug", () => {
    expect(
      isSuppressedDisplayNameCell("name", {
        name: "Acme",
        displayName: "Acme",
      }),
    ).toBe(false);
  });
});
