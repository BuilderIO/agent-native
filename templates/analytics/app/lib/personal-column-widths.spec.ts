import { describe, expect, it } from "vitest";

import {
  activePersonalColumnWidths,
  parsePersonalColumnWidths,
} from "./personal-column-widths";

describe("parsePersonalColumnWidths", () => {
  it("reads nothing from an absent or corrupt value", () => {
    expect(parsePersonalColumnWidths(null)).toEqual({});
    expect(parsePersonalColumnWidths("{not json")).toEqual({});
    expect(parsePersonalColumnWidths("[1,2]")).toEqual({});
  });

  it("keeps well-formed entries and drops the rest", () => {
    const raw = JSON.stringify({
      name: { width: 240, base: null },
      count: { width: 120, base: 90 },
      bad: { width: -5, base: null },
      missingBase: { width: 100 },
    });
    expect(parsePersonalColumnWidths(raw)).toEqual({
      name: { width: 240, base: null },
      count: { width: 120, base: 90 },
    });
  });
});

describe("activePersonalColumnWidths", () => {
  it("applies a width while the dashboard's own width is unchanged", () => {
    const stored = {
      name: { width: 240, base: null },
      count: { width: 120, base: 90 },
    };
    expect(
      activePersonalColumnWidths(stored, [
        { key: "name" },
        { key: "count", width: 90 },
      ]),
    ).toEqual({ name: 240, count: 120 });
  });

  it("drops a width once the dashboard's own width changes", () => {
    const stored = {
      name: { width: 240, base: null },
      count: { width: 120, base: 90 },
    };
    expect(
      activePersonalColumnWidths(stored, [
        { key: "name", width: 300 },
        { key: "count", width: 150 },
      ]),
    ).toEqual({});
  });

  it("applies a width for a column the panel has no config for", () => {
    expect(
      activePersonalColumnWidths(
        { name: { width: 240, base: null } },
        undefined,
      ),
    ).toEqual({ name: 240 });
  });
});
