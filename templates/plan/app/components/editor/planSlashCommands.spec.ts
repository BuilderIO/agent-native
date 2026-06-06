import { describe, expect, it } from "vitest";
import type { BlockRegistry } from "@agent-native/core/blocks";
import { buildPlanSlashCommands } from "./planSlashCommands";

/**
 * The slash menu's block commands are derived from the registry's `"block"`
 * specs, and in Notion-sync mode they must be filtered to the NFM-representable
 * allowlist. We stub the registry's `list("block")` with a representative mix of
 * compatible (callout, checklist, table) and incompatible (wireframe, diagram,
 * code-tabs, html, tabs, question-form) specs.
 */
function stubRegistry(): BlockRegistry {
  const specs = [
    { type: "callout", label: "Callout" },
    { type: "checklist", label: "Checklist" },
    { type: "table", label: "Table" },
    { type: "wireframe", label: "Wireframe" },
    { type: "diagram", label: "Diagram" },
    { type: "code-tabs", label: "Code Tabs" },
    { type: "html", label: "HTML" },
    { type: "tabs", label: "Tabs" },
    { type: "question-form", label: "Question Form" },
  ];
  return { list: () => specs } as unknown as BlockRegistry;
}

// Block command descriptions carry the block `type` (so the menu filter matches
// the type keyword), so the set of registry-block types offered = the set of
// descriptions among the items beyond the base prose commands.
function blockTypesOffered(
  items: ReturnType<typeof buildPlanSlashCommands>,
): string[] {
  const registryTypes = new Set([
    "callout",
    "checklist",
    "table",
    "wireframe",
    "diagram",
    "code-tabs",
    "html",
    "tabs",
    "question-form",
  ]);
  return items
    .map((item) => item.description)
    .filter((description) => registryTypes.has(description));
}

describe("buildPlanSlashCommands", () => {
  it("offers every registry block type in normal mode", () => {
    const items = buildPlanSlashCommands(stubRegistry());
    const offered = blockTypesOffered(items);
    expect(offered).toEqual(
      expect.arrayContaining([
        "callout",
        "checklist",
        "table",
        "wireframe",
        "diagram",
        "code-tabs",
        "html",
        "tabs",
        "question-form",
      ]),
    );
    // Base prose commands are always present.
    expect(items.some((item) => item.title === "Text")).toBe(true);
    expect(items.some((item) => item.title === "Heading 1")).toBe(true);
  });

  it("hides Notion-incompatible block types in notionCompatibleOnly mode", () => {
    const items = buildPlanSlashCommands(stubRegistry(), {
      notionCompatibleOnly: true,
    });
    const offered = blockTypesOffered(items);
    // Compatible types stay.
    expect(offered).toEqual(
      expect.arrayContaining(["callout", "checklist", "table"]),
    );
    // Incompatible types are filtered out.
    for (const type of [
      "wireframe",
      "diagram",
      "code-tabs",
      "html",
      "tabs",
      "question-form",
    ]) {
      expect(offered).not.toContain(type);
    }
    // Prose commands are unaffected.
    expect(items.some((item) => item.title === "Text")).toBe(true);
    expect(items.some((item) => item.title === "Quote")).toBe(true);
  });
});
