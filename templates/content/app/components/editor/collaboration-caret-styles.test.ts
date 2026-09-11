// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { afterEach, describe, expect, it } from "vitest";

describe("collaboration caret styles", () => {
  afterEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
  });

  it("keeps the installed caret and selection renderers out of text layout", () => {
    const user = { name: "Dev", color: "#db70ae" };
    const extension = CollaborationCaret.configure({ provider: {}, user });
    const caret = extension.options.render(user);
    const label = caret.firstElementChild as HTMLElement;
    const selectionAttributes = extension.options.selectionRender(user);
    const selection = document.createElement(
      String(selectionAttributes.nodeName ?? "span"),
    );
    selection.className = String(selectionAttributes.class ?? "");
    selection.setAttribute("style", String(selectionAttributes.style ?? ""));

    const style = document.createElement("style");
    style.textContent = readFileSync("app/global.css", "utf8");
    document.head.append(style);

    const editor = document.createElement("div");
    editor.className = "notion-editor";
    const paragraph = document.createElement("p");
    paragraph.append("Link", caret, selection, " sample.");
    editor.append(paragraph);
    document.body.append(editor);

    expect(getComputedStyle(caret).display).toBe("inline");
    expect(getComputedStyle(caret).position).toBe("relative");
    expect(getComputedStyle(label).display).toBe("inline-block");
    expect(getComputedStyle(label).position).toBe("absolute");
    expect(getComputedStyle(label).width).toBe("max-content");
    expect(getComputedStyle(selection).display).toBe("inline");
    expect(getComputedStyle(selection).borderRadius).toBe("2px");
  });
});
