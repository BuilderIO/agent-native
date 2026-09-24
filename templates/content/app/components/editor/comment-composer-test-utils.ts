import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { act } from "react";

type RichEditorElement = HTMLElement & { editorView?: EditorView };

function editorView(editor: HTMLElement): EditorView {
  const view =
    (editor as RichEditorElement).editorView ??
    (editor as RichEditorElement & { editor?: { view?: EditorView } }).editor
      ?.view ??
    (editor as RichEditorElement & { pmViewDesc?: { view?: EditorView } })
      .pmViewDesc?.view;
  if (!view) throw new Error("ProseMirror editor view unavailable");
  return view;
}

export function richEditor(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(".ProseMirror");
}

export function richEditorValue(editor: HTMLElement): string {
  // Read what a person sees as text: pill avatars are decorative and hidden.
  return [...editor.querySelectorAll(":scope > p")]
    .map((paragraph) => {
      const copy = paragraph.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => {
        node.remove();
      });
      return copy.textContent ?? "";
    })
    .join("\n");
}

export async function setRichEditorValue(
  editor: HTMLElement,
  value: string,
): Promise<void> {
  await act(async () => {
    editor.focus();
    editor.replaceChildren(
      ...value.split("\n").map((line) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = line;
        return paragraph;
      }),
    );
    editor.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: value,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}

export function setRichEditorValueSync(
  editor: HTMLElement,
  value: string,
): void {
  editor.focus();
  editor.replaceChildren(
    ...value.split("\n").map((line) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      return paragraph;
    }),
  );
  editor.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: value,
    }),
  );
}

export async function setRichEditorSelection(
  editor: HTMLElement,
  start: number,
  end: number,
  direction: "forward" | "backward" = "forward",
): Promise<void> {
  await act(async () => {
    editor.focus();
    const view = editorView(editor);
    const anchor = (direction === "backward" ? end : start) + 1;
    const head = (direction === "backward" ? start : end) + 1;
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, anchor, head),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export async function typeRichEditorText(
  editor: HTMLElement,
  value: string,
): Promise<void> {
  await act(async () => {
    editor.focus();
    const view = editorView(editor);
    for (const character of value) {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", { key: character, bubbles: true }),
      );
      view.dispatch(view.state.tr.insertText(character));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

export function selectedRichText(editor?: HTMLElement): string {
  if (!editor) return document.getSelection()?.toString() ?? "";
  const { state } = editorView(editor);
  return state.doc.textBetween(state.selection.from, state.selection.to);
}

export function richSelectionDirection(
  editor?: HTMLElement,
): "forward" | "backward" | "none" {
  if (editor) {
    const { anchor, head } = editorView(editor).state.selection;
    return anchor === head ? "none" : anchor > head ? "backward" : "forward";
  }
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed) return "none";
  if (selection.anchorNode === selection.focusNode) {
    return selection.anchorOffset > selection.focusOffset
      ? "backward"
      : "forward";
  }
  const range = document.createRange();
  range.setStart(selection.anchorNode!, selection.anchorOffset);
  range.setEnd(selection.focusNode!, selection.focusOffset);
  return range.collapsed ? "backward" : "forward";
}
