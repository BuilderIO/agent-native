import { describe, expect, it } from "vitest";

import { activePersonalColumnWidths } from "../app/lib/personal-column-widths";
import { isValidPanelColumns, readPanelColumns } from "./panel-columns";

describe("panel columns", () => {
  it("accepts the documented column list", () => {
    expect(
      isValidPanelColumns([
        { key: "rate", format: "percent", label: "Rate", width: 90 },
        { key: "hidden_one", hidden: true },
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
  it("reader drops columns with malformed properties", () => {
    expect(
      readPanelColumns([{ key: "a", label: {} } as never, { key: "b" }]),
    ).toEqual([{ key: "b" }]);
  });
});
