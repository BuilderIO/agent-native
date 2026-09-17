import { describe, expect, it } from "vitest";

import {
  applySuggestionOperations,
  digest,
  makeAnchor,
  suggestionDecorations,
  supportsSuggestionBlock,
  supportsSuggestionMark,
  textContent,
  type SuggestionNode,
  type SuggestionOperation,
  type TextOperation,
} from "./model";

const doc = (text: string): SuggestionNode => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

function textOp(
  kind: "insert_text" | "delete_text" | "replace_text",
  from: number,
  to: number,
  before: string,
  after: string,
  base: SuggestionNode,
): SuggestionOperation {
  return {
    id: kind,
    kind,
    from,
    to,
    before,
    after,
    baseDigest: digest(textContent(base)),
    anchor: makeAnchor(textContent(base), from, to),
  };
}

describe("suggestion model", () => {
  it("applies exact ordered text operations without mutating canonical input", () => {
    const canonical = doc("Hello world");
    const add = textOp("insert_text", 5, 5, "", ", brave", canonical);
    const afterAdd = applySuggestionOperations(canonical, [add]);
    const replace = textOp("replace_text", 13, 18, "world", "reader", afterAdd);
    const result = applySuggestionOperations(canonical, [add, replace]);

    expect(textContent(result)).toBe("Hello, brave reader");
    expect(textContent(canonical)).toBe("Hello world");
    expect((add as TextOperation).before).toBe("");
    expect((replace as TextOperation).before).toBe("world");
  });

  it("rejects stale or inaccurate before-state", () => {
    const canonical = doc("Hello");
    expect(() =>
      applySuggestionOperations(canonical, [
        textOp("delete_text", 0, 5, "World", "", canonical),
      ]),
    ).toThrow("before-state");
    const stale = {
      ...textOp("delete_text", 0, 5, "Hello", "", canonical),
      baseDigest: "deadbeef",
    };
    expect(() => applySuggestionOperations(canonical, [stale])).toThrow(
      "stale base",
    );
  });

  it("supports new blocks and inline mark changes with gating", () => {
    const canonical = doc("Hello");
    const block: SuggestionOperation = {
      id: "block",
      kind: "add_text_block",
      index: 1,
      block: { type: "paragraph", content: [{ type: "text", text: "Next" }] },
      baseDigest: digest(textContent(canonical)),
      anchor: makeAnchor("Hello", 5, 5),
    };
    const marked: SuggestionOperation = {
      id: "mark",
      kind: "set_inline_mark",
      from: 0,
      to: 5,
      mark: { type: "bold" },
      enabled: true,
      before: [[]],
      after: [[{ type: "bold" }]],
      baseDigest: digest(textContent(canonical)),
      anchor: makeAnchor("Hello", 0, 5),
    };
    const result = applySuggestionOperations(canonical, [block]);
    expect(result.content).toHaveLength(2);
    expect(suggestionDecorations(canonical, [marked])).toMatchObject([
      { kind: "set_inline_mark", from: 0, to: 5 },
    ]);
    expect(supportsSuggestionBlock(block.block)).toBe(true);
    expect(supportsSuggestionMark(marked.mark)).toBe(true);
    expect(supportsSuggestionBlock({ type: "image" })).toBe(false);
    expect(supportsSuggestionMark({ type: "highlight" } as any)).toBe(false);
  });
});
