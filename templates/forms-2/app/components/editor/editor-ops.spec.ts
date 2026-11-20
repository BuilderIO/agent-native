import {
  deriveQuestions,
  questionBlocks,
  type Block,
} from "@shared/form-model";
import { describe, expect, it } from "vitest";

import {
  addOptionAfter,
  makeBlocks,
  moveItem,
  moveItemTo,
  removeItem,
  removeOption,
  toItems,
  toggleThankYou,
  withFormTitle,
} from "./editor-ops";

function form(): Block[] {
  return [
    ...withFormTitle([]),
    ...questionBlocks({ id: "a", type: "INPUT_TEXT", title: "A" }),
    ...questionBlocks({ id: "b", type: "RATING", title: "B" }),
    ...questionBlocks({
      id: "c",
      type: "MULTIPLE_CHOICE",
      title: "C",
      options: ["x", "y"],
    }),
  ];
}

const titles = (blocks: Block[]) => deriveQuestions(blocks).map((q) => q.title);

describe("editor ops", () => {
  it("moves a whole question one slot and keeps the form title first", () => {
    const moved = moveItem(form(), "b", -1);
    expect(titles(moved)).toEqual(["B", "A", "C"]);
    expect(moved[0]?.type).toBe("FORM_TITLE");
    const base = form();
    expect(moveItem(base, "a", -1)).toEqual(base);
  });

  it("drops an item before or after a target", () => {
    expect(titles(moveItemTo(form(), "a", "c", "after"))).toEqual([
      "B",
      "C",
      "A",
    ]);
    expect(titles(moveItemTo(form(), "c", "a", "before"))).toEqual([
      "C",
      "A",
      "B",
    ]);
  });

  it("deleting a question removes its options too", () => {
    const next = removeItem(form(), "c");
    expect(next.some((block) => block.groupUuid === "c")).toBe(false);
  });

  it("adds and removes options keeping first/last flags", () => {
    const blocks = form();
    const first = blocks.find((block) => block.uuid === "c:option-0");
    expect(first).toBeDefined();
    const { blocks: added, added: id } = addOptionAfter(blocks, "c:option-0");
    const options = added.filter(
      (block) =>
        block.groupUuid === "c" && block.type === "MULTIPLE_CHOICE_OPTION",
    );
    expect(options.map((block) => block.uuid)[1]).toBe(id);
    expect(
      options.map((block) => (block.payload as { isLast?: boolean }).isLast),
    ).toEqual([false, false, true]);
    const removed = removeOption(added, id);
    expect(
      removed.filter((block) => block.type === "MULTIPLE_CHOICE_OPTION"),
    ).toHaveLength(2);
  });

  it("a new logic block starts on the previous question of the same page", () => {
    const blocks = [...form(), ...makeBlocks("PAGE_BREAK")];
    const [logic] = makeBlocks("CONDITIONAL_LOGIC", blocks, blocks.length);
    expect((logic?.payload as { condition: unknown }).condition).toBeNull();
    const [onPageOne] = makeBlocks("CONDITIONAL_LOGIC", form());
    expect(
      (onPageOne?.payload as { condition: { questionId: string } }).condition
        .questionId,
    ).toBe("c");
  });

  it("toggles a page break into the thank-you page and back", () => {
    const [page] = makeBlocks("PAGE_BREAK");
    if (!page) throw new Error("no block");
    const once = toggleThankYou([page], page.uuid);
    expect(once[0]?.type).toBe("THANK_YOU_PAGE");
    expect(toggleThankYou(once, page.uuid)[0]?.type).toBe("PAGE_BREAK");
  });

  it("groups a question into one item", () => {
    expect(toItems(form().slice(1)).map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
