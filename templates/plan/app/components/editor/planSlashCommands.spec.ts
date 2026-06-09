import { describe, expect, it } from "vitest";
import type { BlockRegistry } from "@agent-native/core/blocks";
import { buildPlanSlashCommands } from "./planSlashCommands";

/**
 * The slash menu's block commands are derived from the registry's `"block"`
 * specs, and in Notion-sync mode they must be filtered to the NFM-representable
 * allowlist. We stub the registry's `list("block")` with the full plan +
 * standard-library set so a newly registered block cannot silently disappear
 * from the slash menu.
 */
const REGISTRY_TYPES = [
  "callout",
  "diagram",
  "wireframe",
  "question-form",
  "visual-questions",
  "checklist",
  "table",
  "code-tabs",
  "custom-html",
  "tabs",
  "columns",
  "mermaid",
  "api-endpoint",
  "openapi-spec",
  "data-model",
  "diff",
  "file-tree",
  "json-explorer",
  "annotated-code",
] as const;

function stubRegistry(): BlockRegistry {
  const labels: Record<(typeof REGISTRY_TYPES)[number], string> = {
    callout: "Callout",
    diagram: "Diagram",
    wireframe: "Wireframe",
    "question-form": "Question Form",
    "visual-questions": "Visual Questions",
    checklist: "Checklist",
    table: "Table",
    "code-tabs": "Code Tabs",
    "custom-html": "HTML / Tailwind",
    tabs: "Tabs",
    columns: "Columns",
    mermaid: "Diagram (Mermaid)",
    "api-endpoint": "API endpoint",
    "openapi-spec": "OpenAPI spec",
    "data-model": "Data model",
    diff: "Diff",
    "file-tree": "File tree",
    "json-explorer": "JSON explorer",
    "annotated-code": "Annotated code",
  };
  const descriptions: Partial<Record<(typeof REGISTRY_TYPES)[number], string>> =
    {
      "api-endpoint": "A Swagger-style API endpoint reference.",
      "openapi-spec": "A whole-document API specification.",
      "data-model": "A schema modeling ERD.",
    };
  const specs = REGISTRY_TYPES.map((type) => ({
    type,
    label: labels[type],
    description: descriptions[type] ?? `${labels[type]} block.`,
  }));
  return { list: () => specs } as unknown as BlockRegistry;
}

// Block command search text carries the block `type` (so the menu filter matches
// the type keyword), so the set of registry-block types offered = the set of
// search keywords among the items beyond the base prose commands.
function blockTypesOffered(
  items: ReturnType<typeof buildPlanSlashCommands>,
): string[] {
  const registryTypes = new Set<string>(REGISTRY_TYPES);
  return items
    .map((item) => item.searchText?.toLowerCase() ?? "")
    .map(
      (searchText) =>
        REGISTRY_TYPES.find(
          (type) => searchText === type || searchText.endsWith(` ${type}`),
        ) ?? "",
    )
    .filter((type) => registryTypes.has(type));
}

describe("buildPlanSlashCommands", () => {
  it("offers every registry block type in normal mode", () => {
    const items = buildPlanSlashCommands(stubRegistry());
    const offered = blockTypesOffered(items);
    expect(offered).toEqual([...REGISTRY_TYPES]);
    // Base prose commands are always present.
    expect(items.some((item) => item.title === "Text")).toBe(true);
    expect(items.some((item) => item.title === "Heading 1")).toBe(true);
  });

  it("keeps human aliases searchable alongside raw block types", () => {
    const items = buildPlanSlashCommands(stubRegistry());
    const searchTexts = items.map((item) => item.searchText?.toLowerCase());
    expect(
      searchTexts.some((searchText) => searchText?.includes("swagger")),
    ).toBe(true);
    expect(
      searchTexts.some((searchText) =>
        searchText?.includes("api specification"),
      ),
    ).toBe(true);
    expect(
      searchTexts.some((searchText) => searchText?.includes("schema modeling")),
    ).toBe(true);
    expect(
      searchTexts.some((searchText) => searchText?.endsWith(" api-endpoint")),
    ).toBe(true);
  });

  it("uses compact visible descriptions for registry blocks", () => {
    const items = buildPlanSlashCommands(stubRegistry());
    const apiEndpoint = items.find((item) => item.title === "API endpoint");
    expect(apiEndpoint?.description).toBe("API reference");
    expect(apiEndpoint?.description).not.toContain("Block type:");
    expect(apiEndpoint?.searchText).toContain("api-endpoint");
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
    for (const type of REGISTRY_TYPES.filter(
      (type) => !["callout", "checklist", "table"].includes(type),
    )) {
      expect(offered).not.toContain(type);
    }
    // Prose commands are unaffected.
    expect(items.some((item) => item.title === "Text")).toBe(true);
    expect(items.some((item) => item.title === "Quote")).toBe(true);
  });
});
