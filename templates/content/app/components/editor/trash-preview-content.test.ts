import { describe, expect, it } from "vitest";

import { nfmToDoc, type PMNode } from "../../../shared/nfm";
import { prepareTrashPreviewContent } from "./trash-preview-content";

function nodes(content: string) {
  const result: PMNode[] = [];
  function walk(node: PMNode) {
    result.push(node);
    node.content?.forEach(walk);
  }
  nfmToDoc(content).content.forEach(walk);
  return result;
}

describe("Trash editor content preparation", () => {
  it("preserves native display and inline math atoms", () => {
    const source = "$$\nE=mc^2\n$$\n\nInline $a^2+b^2$ math.";
    const prepared = prepareTrashPreviewContent(source);
    expect(prepared.hasSourceBlocks).toBe(false);
    expect(nodes(prepared.content)).toEqual(nodes(source));
    expect(nodes(prepared.content)).toContainEqual(
      expect.objectContaining({
        type: "notionBlockAtom",
        attrs: expect.objectContaining({
          tagName: "equation",
          label: "E=mc^2",
        }),
      }),
    );
  });

  it("keeps other block atoms inert alongside native display math", () => {
    const source =
      '$$\nE=mc^2\n$$\n\n<page url="https://example.com/page">Linked page</page>\n\n<UnsafeWidget />';
    const prepared = prepareTrashPreviewContent(source);
    const parsed = nodes(prepared.content);
    expect(prepared.hasSourceBlocks).toBe(true);
    expect(parsed.filter((node) => node.type === "notionBlockAtom")).toEqual([
      expect.objectContaining({
        attrs: expect.objectContaining({ tagName: "equation" }),
      }),
    ]);
    expect(parsed.filter((node) => node.type === "codeBlock")).toHaveLength(2);
    expect(
      parsed.some((node) =>
        ["registryBlock", "localMdxComponent", "contentReference"].includes(
          node.type,
        ),
      ),
    ).toBe(false);
  });

  it("keeps active MDX and reference sources visible as inert code", () => {
    const source =
      '<UnsafeWidget id="example">\n```\n<AnotherWidget />\n```\n</UnsafeWidget>';
    const prepared = prepareTrashPreviewContent(source);
    const parsed = nodes(prepared.content);
    expect(prepared.hasSourceBlocks).toBe(true);
    expect(
      parsed.some((node) =>
        ["registryBlock", "localMdxComponent", "contentReference"].includes(
          node.type,
        ),
      ),
    ).toBe(false);
    expect(
      parsed.find((node) => node.type === "codeBlock")?.content?.[0].text,
    ).toBe(source);
  });

  it("preserves native tables, toggle and image nodes", () => {
    const source =
      '<table header-row="true">\n\t<tr>\n\t\t<td>Name</td>\n\t\t<td>Value</td>\n\t</tr>\n</table>\n\n<details>\n<summary>Toggle</summary>\nBody\n</details>\n\n![Picture](https://example.com/picture.png)';
    const before = nodes(source).map((node) => node.type);
    const after = nodes(prepareTrashPreviewContent(source).content).map(
      (node) => node.type,
    );
    expect(after).toEqual(before);
    expect(after).toContain("table");
    expect(after).toContain("notionToggle");
    expect(after).toContain("image");
  });
});
