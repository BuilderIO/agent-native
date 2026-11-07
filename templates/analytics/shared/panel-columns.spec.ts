import { describe, expect, it } from "vitest";

import { activePersonalColumnWidths } from "../app/lib/personal-column-widths";
import { isValidPanelColumns, readPanelColumns } from "./panel-columns";
import { unknownPanelConfigKeys } from "./panel-render-contract";

describe("panel columns", () => {
  it("accepts the documented column list", () => {
    expect(
      isValidPanelColumns([
        { key: "rate", format: "percent", label: "Rate", width: 90 },
        { key: "hidden_one", hidden: true, width: 0.5 },
      ]),
    ).toBe(true);
    expect(isValidPanelColumns([{ key: "rate", format: "pct" }])).toBe(false);
    expect(isValidPanelColumns("rate")).toBe(false);
  });

  it("renders a stored non-array as unconfigured instead of throwing", () => {
    const stored = {
      discount_rate: { format: "percent" },
    } as unknown as { key: string }[];
    expect(readPanelColumns(stored)).toBeUndefined();
    expect(() =>
      activePersonalColumnWidths(
        { rate: { width: 100, base: null } },
        readPanelColumns(stored),
      ),
    ).not.toThrow();
  });
});

describe("panel columns strictness", () => {
  it("rejects duplicate keys", () => {
    expect(isValidPanelColumns([{ key: "a" }, { key: "a" }])).toBe(false);
  });

  it.each([
    { columns: [{ key: "a" }, { key: "a" }] },
    { columns: [{ key: "a", width: "wide", hidden: true }] },
    { columns: [{ key: "a", width: 0, hidden: true }] },
    { columns: [{ key: "a", width: -10, hidden: true }] },
    { columns: [{ key: "rate", formatt: "percent" }] },
    { columns: [{ key: "a", constructor: "unexpected" }] },
  ])("flags malformed columns in the save contract", ({ columns }) => {
    expect(
      unknownPanelConfigKeys({
        id: "p",
        title: "Table",
        sql: "SELECT 1",
        source: "bigquery",
        chartType: "table",
        width: 1,
        config: { columns },
      }),
    ).toEqual([
      expect.objectContaining({ kind: "invalid-value", key: "columns" }),
    ]);
  });
  it("retains valid settings when malformed optional properties are removed", () => {
    const stored = [
      { key: "visible", label: 4, format: "pct", linkKey: {}, hidden: "yes" },
      {
        key: "hidden",
        width: "wide",
        hidden: true,
        label: "Private",
        formatt: "percent",
      },
      { key: "infinite", width: Infinity, format: "number" },
      { key: "zero", width: 0, hidden: true },
      { key: "negative", width: -10, label: "Negative" },
    ];
    const columns = readPanelColumns(stored as never);
    expect(columns).toEqual([
      { key: "visible" },
      { key: "hidden", hidden: true, label: "Private" },
      { key: "infinite", format: "number" },
      { key: "zero", hidden: true },
      { key: "negative", label: "Negative" },
    ]);
    expect(isValidPanelColumns(columns)).toBe(true);
    expect(stored[1]).toEqual({
      key: "hidden",
      width: "wide",
      hidden: true,
      label: "Private",
      formatt: "percent",
    });
  });

  it("keeps the first keyed entry and ignores malformed or duplicate entries", () => {
    const columns = readPanelColumns([
      null,
      "column",
      [],
      {},
      { key: "" },
      { key: "a", width: "bad", hidden: true },
      { key: "a", label: "Later" },
      { key: "b", width: 120 },
      { key: "b", hidden: true },
    ] as never);
    expect(columns).toEqual([
      { key: "a", hidden: true },
      { key: "b", width: 120 },
    ]);
    expect(isValidPanelColumns(columns)).toBe(true);
  });
});
