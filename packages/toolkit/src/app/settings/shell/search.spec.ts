import { describe, expect, it } from "vitest";

import { defineSettingsPage } from "./registry.js";
import { buildSettingsSearchIndex, searchSettings } from "./search.js";

const Stub = () => null;

const model = defineSettingsPage({
  id: "model",
  group: "agent",
  order: 10,
  labelKey: "page.model",
  icon: Stub,
  component: Stub,
  keywords: "llm provider",
});

const index = buildSettingsSearchIndex(
  [
    {
      page: model,
      label: "Model",
      groupLabel: "Agent",
      entries: [
        {
          id: "max-iterations",
          labelKey: "row.maxIterations",
          keywords: "limits loop",
          anchor: "limits",
        },
      ],
    },
  ],
  (key) => (key === "row.maxIterations" ? "Max iterations" : key),
);

describe("settings shell search", () => {
  it("finds pages by label and keywords", () => {
    expect(searchSettings(index, "llm")[0]).toMatchObject({
      label: "Model",
      where: "Agent",
      page: "model",
    });
  });

  it("finds rows and says where they live", () => {
    expect(searchSettings(index, "max iter")[0]).toMatchObject({
      label: "Max iterations",
      where: "Agent › Model",
      page: "model",
      anchor: "limits",
    });
  });

  it("skips a row that only repeats its page's name", () => {
    const withDuplicate = buildSettingsSearchIndex(
      [
        {
          page: model,
          label: "Model",
          groupLabel: "Agent",
          entries: [{ id: "section:llm", label: "Model", anchor: "llm" }],
        },
      ],
      (key) => key,
    );
    expect(searchSettings(withDuplicate, "model")).toHaveLength(1);
  });

  it("keeps the page's own row when a bridged entry repeats its name", () => {
    const withBridged = buildSettingsSearchIndex(
      [
        {
          page: model,
          label: "Model",
          groupLabel: "Agent",
          entries: [
            { id: "limits", label: "Limits", anchor: "limits" },
            { id: "section:limits", label: "Limits", anchor: "old-limits" },
          ],
        },
      ],
      (key) => key,
    );
    expect(searchSettings(withBridged, "limits")).toMatchObject([
      { label: "Limits", anchor: "limits" },
    ]);
  });

  it("returns nothing for an empty query", () => {
    expect(searchSettings(index, "   ")).toEqual([]);
  });
});
