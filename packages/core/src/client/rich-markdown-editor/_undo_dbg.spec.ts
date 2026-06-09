// @vitest-environment happy-dom
import { describe, it } from "vitest";
import { Editor, Node } from "@tiptap/core";
import { createRichMarkdownExtensions } from "./RichMarkdownEditor.js";
const BlockAtom = Node.create({
  name: "blockAtom",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { blockId: { default: null } };
  },
  parseHTML() {
    return [{ tag: "div[data-block-atom]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-block-atom": "" }];
  },
});
const docOf = (ids: string[]) => ({
  type: "doc",
  content: ids.map((id) => ({ type: "blockAtom", attrs: { blockId: id } })),
});
function mk(ids: string[]) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [...createRichMarkdownExtensions(), BlockAtom],
    content: docOf(ids),
  });
}
function order(e: Editor) {
  const o: string[] = [];
  e.state.doc.forEach((n) => {
    if (n.type.name === "blockAtom") o.push(n.attrs.blockId);
  });
  return o;
}
function reorder(e: Editor, ids: string[], hist: boolean) {
  const v = e.view;
  const nx = v.state.schema.nodeFromJSON(docOf(ids));
  const tr = v.state.tr.replaceWith(0, v.state.doc.content.size, nx.content);
  if (!hist) tr.setMeta("addToHistory", false);
  v.dispatch(tr);
}
function modz(e: Editor, shift?: boolean) {
  const isMac = /Mac/.test(navigator.platform || "");
  const ev = new KeyboardEvent("keydown", {
    key: shift ? "Z" : "z",
    code: "KeyZ",
    metaKey: isMac,
    ctrlKey: !isMac,
    shiftKey: !!shift,
    bubbles: true,
    cancelable: true,
  });
  return e.view.someProp("handleKeyDown", (f: any) => f(e.view, ev)) ?? false;
}
describe("dbg", () => {
  it("hist", () => {
    const log: any = {};
    const e = mk(["a", "b", "c"]);
    log.platform = navigator.platform;
    log.start = order(e);
    log.canUndo0 = e.can().undo();
    reorder(e, ["c", "a", "b"], true);
    log.afterReorder = order(e);
    log.canUndo1 = e.can().undo();
    log.undid = modz(e);
    log.afterUndo = order(e);
    log.canRedo = e.can().redo();
    log.redid = modz(e, true);
    log.afterRedo = order(e);
    log.cmdRedo = e.commands.redo();
    log.afterCmdRedo = order(e);
    throw new Error("DBG " + JSON.stringify(log));
  });
});
