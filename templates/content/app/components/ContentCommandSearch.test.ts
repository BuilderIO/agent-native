import { describe, expect, it } from "vitest";

import {
  modifiedAfterForFilter,
  presetForModifiedDate,
} from "./ContentCommandSearch";

describe("modifiedAfterForFilter", () => {
  it("keeps any, preset, and custom states mutually exclusive", () => {
    expect(modifiedAfterForFilter({ kind: "any" })).toBeUndefined();
    expect(
      modifiedAfterForFilter(
        { kind: "preset", days: 7 },
        new Date(2026, 8, 14, 17, 45),
      ),
    ).toBe(new Date(2026, 8, 8).toISOString());
    expect(
      modifiedAfterForFilter({
        kind: "custom",
        day: "2026-09-03",
        modifiedAfter: new Date(2026, 8, 3).toISOString(),
      }),
    ).toBe(new Date(2026, 8, 3).toISOString());
    expect(presetForModifiedDate({ kind: "any" })).toBe("all");
    expect(presetForModifiedDate({ kind: "preset", days: 7 })).toBe("7");
    expect(
      presetForModifiedDate({
        kind: "custom",
        day: "2026-09-03",
        modifiedAfter: new Date(2026, 8, 3).toISOString(),
      }),
    ).toBeUndefined();
  });

  it("includes today in preset day counts from local midnight", () => {
    expect(
      modifiedAfterForFilter(
        { kind: "preset", days: 30 },
        new Date(2026, 8, 14, 23, 59),
      ),
    ).toBe(new Date(2026, 7, 16).toISOString());
  });
});
