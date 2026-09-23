// @vitest-environment happy-dom

import { docToNfm, nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, expect, it } from "vitest";

import { createVisualEditorExtensions } from "./VisualEditor";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(document, "compatMode", {
    configurable: true,
    value: "CSS1Compat",
  });
});

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
});

it("renders an editable aligned table and saves its cell changes", async () => {
  const source =
    "Before.\n| Name | Price |\n| :--- | ---: |\n| **A** | $1 | extra |\nAfter.";
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const editor = new Editor({
    extensions: createVisualEditorExtensions(),
    content: nfmToDoc(source),
  });
  cleanup.push(() => {
    act(() => root.unmount());
    editor.destroy();
    container.remove();
  });

  await act(async () => root.render(<EditorContent editor={editor} />));

  const table =
    container.querySelector(".notion-editor table") ??
    container.querySelector("table");
  expect(table).not.toBeNull();
  expect(table?.querySelectorAll("tr")).toHaveLength(2);
  expect(table?.querySelectorAll("td")).toHaveLength(6);
  expect(table?.querySelector("strong")?.textContent).toBe("A");
  expect(table?.querySelectorAll('td[data-alignment="right"]')).toHaveLength(2);
  expect(container.textContent).not.toContain("Unresolved GFM table");
  const firstCell = editor.state.doc.child(1).firstChild!.firstChild!;
  expect(firstCell.attrs.textAlign).toBe("left");
  let pricePosition = -1;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "tableCell" && node.textContent === "$1") {
      pricePosition = position + 2;
      return false;
    }
    return true;
  });
  expect(pricePosition).toBeGreaterThan(0);
  await act(async () => {
    editor.view.dispatch(editor.state.tr.insertText("Edited ", pricePosition));
  });

  const after = editor.state.doc.lastChild;
  expect(after?.type.name).toBe("paragraph");
  await act(async () => {
    const position = editor.state.doc.content.size - after!.nodeSize + 1;
    editor.view.dispatch(editor.state.tr.insertText("Changed ", position));
  });
  expect(docToNfm(editor.getJSON())).toContain('align="right"');
  expect(docToNfm(editor.getJSON())).toContain("Edited \\$1");
  expect(docToNfm(editor.getJSON())).toContain("extra");
  expect(docToNfm(editor.getJSON())).toContain("Changed After.");
});
