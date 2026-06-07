// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { createRegistryBlockNode } from "./RegistryBlockNode.js";

const PlanBlockNode = createRegistryBlockNode({
  nodeName: "planBlock",
  dataTag: "data-plan-block",
  mintId: (blockType) => `${blockType}-fresh`,
});

function createEditor(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [StarterKit, PlanBlockNode],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Before" }],
        },
        {
          type: "planBlock",
          attrs: {
            blockType: "diagram",
            blockId: "diagram-1",
            title: "Architecture diagram",
            summary: null,
            sourceBlockId: null,
            __raw: null,
          },
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "After" }],
        },
      ],
    },
  });
}

function findPlanBlockPos(editor: Editor): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "planBlock") {
      found = pos;
      return false;
    }
    return true;
  });
  if (found < 0) throw new Error("Expected planBlock node");
  return found;
}

function selectPlanBlock(editor: Editor): void {
  const pos = findPlanBlockPos(editor);
  editor.view.dispatch(
    editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)),
  );
}

function planBlockSnapshot(editor: Editor): unknown {
  return editor.state.doc.nodeAt(findPlanBlockPos(editor))?.toJSON();
}

function runKeyDown(editor: Editor, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  const handled = editor.view.someProp("handleKeyDown", (handler) =>
    handler(editor.view, event),
  );
  expect(handled).toBe(true);
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("RegistryBlockNode keyboard guard", () => {
  it("keeps selected registry atoms immutable for text entry and preserves undo history", () => {
    const editor = createEditor();

    try {
      editor.commands.setTextSelection(7);
      editor.commands.insertContent("!");
      expect(editor.state.doc.child(0).textContent).toBe("Before!");

      selectPlanBlock(editor);
      const beforeAtom = planBlockSnapshot(editor);

      const keyEvent = runKeyDown(editor, "x");
      expect(keyEvent.defaultPrevented).toBe(true);
      expect(planBlockSnapshot(editor)).toEqual(beforeAtom);

      const enterEvent = runKeyDown(editor, "Enter");
      expect(enterEvent.defaultPrevented).toBe(true);
      expect(planBlockSnapshot(editor)).toEqual(beforeAtom);

      const textInputHandled = editor.view.someProp(
        "handleTextInput",
        (handler) => handler(editor.view, 0, 0, "typed"),
      );
      expect(textInputHandled).toBe(true);
      expect(planBlockSnapshot(editor)).toEqual(beforeAtom);

      const pasteEvent = new Event("paste", {
        bubbles: true,
        cancelable: true,
      }) as ClipboardEvent;
      const pasteHandled = editor.view.someProp("handlePaste", (handler) =>
        handler(editor.view, pasteEvent, Slice.empty),
      );
      expect(pasteHandled).toBe(true);
      expect(pasteEvent.defaultPrevented).toBe(true);
      expect(planBlockSnapshot(editor)).toEqual(beforeAtom);

      const beforeInputEvent = new InputEvent("beforeinput", {
        data: "z",
        inputType: "insertText",
        bubbles: true,
        cancelable: true,
      });
      const beforeInputHandled = editor.view.someProp(
        "handleDOMEvents",
        (handlers) => handlers.beforeinput?.(editor.view, beforeInputEvent),
      );
      expect(beforeInputHandled).toBe(true);
      expect(beforeInputEvent.defaultPrevented).toBe(true);
      expect(planBlockSnapshot(editor)).toEqual(beforeAtom);

      expect(editor.commands.undo()).toBe(true);
      expect(editor.state.doc.child(0).textContent).toBe("Before");
      expect(editor.state.doc.textContent).not.toContain("Module");
      expect(planBlockSnapshot(editor)).toEqual(beforeAtom);
    } finally {
      editor.destroy();
    }
  });
});
