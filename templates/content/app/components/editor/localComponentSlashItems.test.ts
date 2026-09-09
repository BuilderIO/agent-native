// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { buildLocalComponentSlashItems } from "./localComponentSlashItems";

function fakeEditor() {
  let inserted: any = null;
  const chain = {
    focus: () => ({
      insertContent: (content: unknown) => {
        inserted = content;
        return { run: () => true };
      },
    }),
  };
  return {
    editor: { chain: () => chain },
    getInserted: () => inserted,
  };
}

describe("buildLocalComponentSlashItems", () => {
  it("derives slash items from PascalCase local component exports", () => {
    const items = buildLocalComponentSlashItems({
      ImpactCounter: function ImpactCounter() {
        return null;
      },
      InlineDemo: function InlineDemo() {
        return null;
      },
      helper: function helper() {
        return null;
      },
      ValueOnly: "not a component",
    });

    expect(items.map((item) => item.title)).toEqual([
      "Impact Counter",
      "Inline Demo",
    ]);
    expect(items[0].searchText).toContain("ImpactCounter");
    expect(items[0].description).toBe("Local MDX component");
  });

  it("inserts a source-preserving localMdxComponent node", () => {
    const items = buildLocalComponentSlashItems({
      ImpactCounter: function ImpactCounter() {
        return null;
      },
    });
    const { editor, getInserted } = fakeEditor();

    items[0].action(editor as never);

    expect(getInserted()).toEqual({
      type: "localMdxComponent",
      attrs: {
        name: "ImpactCounter",
        propsJson: "{}",
        unsupportedProps: false,
        children: "",
        __raw: "<ImpactCounter />",
      },
    });
  });
});
