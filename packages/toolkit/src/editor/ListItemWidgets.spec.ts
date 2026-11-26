// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { createListItemWidgets } from "./ListItemWidgets.js";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("createListItemWidgets", () => {
  it("draws the app's element inside each list item, with the heading above it, without saving it", () => {
    const seen: Array<{ itemText: string; headingText: string | null }> = [];
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [
        StarterKit,
        createListItemWidgets("qaWidgets", {
          render: (item) => {
            seen.push(item);
            if (item.headingText !== "Action items") return null;
            const button = document.createElement("button");
            button.setAttribute("aria-label", `rate ${item.itemText}`);
            return button;
          },
        }),
      ],
      content:
        "<ul><li><p>Loose item</p></li></ul><h2>Action items</h2><ul><li><p>Send the recap</p></li></ul><h2>Notes</h2><ul><li><p>A point</p></li></ul>",
    });
    expect(seen).toEqual([
      { itemText: "Loose item", headingText: null },
      { itemText: "Send the recap", headingText: "Action items" },
      { itemText: "A point", headingText: "Notes" },
    ]);
    const buttons = editor.view.dom.querySelectorAll("li button");
    expect([...buttons].map((b) => b.getAttribute("aria-label"))).toEqual([
      "rate Send the recap",
    ]);
    expect(buttons[0]?.closest("li")?.textContent).toBe("Send the recap");
    expect(editor.getHTML()).not.toContain("button");
  });
});
