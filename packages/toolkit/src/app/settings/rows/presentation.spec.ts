import { describe, expect, it } from "vitest";

import {
  resolveSettingsPresentation,
  selectedSettingsAdornment,
} from "./presentation.js";
import type { SettingsOption, SettingsSectionsProps } from "./schema.js";

describe("settings presentation bridge", () => {
  it("projects grouped metadata through nested rows and keeps legacy defaults", () => {
    const input: SettingsSectionsProps = {
      hints: { frame: "old", gap: 1 },
      reference: { layout: { frame: "current" } },
      sections: [
        {
          id: "general",
          headingId: "legacy-heading",
          rows: [
            {
              id: "settings.general.items",
              kind: "collection",
              label: "Items",
              dom: { anchorId: "items-anchor" },
              items: {
                status: "ready",
                value: [
                  {
                    key: "item",
                    title: "Item",
                    attributes: { "data-legacy": "value" },
                    reference: { attributes: { "data-testid": "fixture" } },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const resolved = resolveSettingsPresentation(input);
    expect(resolved.hints).toEqual({ frame: "current", gap: 1 });
    expect(resolved.sections[0]?.headingId).toBe("legacy-heading");
    const row = resolved.sections[0]?.rows[0];
    if (row?.kind !== "collection" || row.items.status !== "ready")
      throw new Error("Expected collection");
    expect(row.anchorId).toBe("items-anchor");
    expect(row.items.value[0]?.attributes).toEqual({
      "data-legacy": "value",
      "data-testid": "fixture",
    });
  });
  it("chooses the adornment of the bound select value", () => {
    const options: readonly SettingsOption[] = [
      {
        value: "count",
        label: "Count",
        adornment: { kind: "badge", text: "1" },
      },
      { value: "dot", label: "Dot", adornment: { kind: "dot" } },
    ];
    expect(selectedSettingsAdornment(options, "count")).toEqual({
      kind: "badge",
      text: "1",
    });
    expect(selectedSettingsAdornment(options, "dot")).toEqual({ kind: "dot" });
    expect(selectedSettingsAdornment(options, null)).toBeUndefined();
  });
});
