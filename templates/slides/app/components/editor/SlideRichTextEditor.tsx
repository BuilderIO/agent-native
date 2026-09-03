import { SharedRichEditor } from "@agent-native/toolkit/editor";
import { Extension } from "@tiptap/core";
import { TextStyle } from "@tiptap/extension-text-style";
import type { Editor } from "@tiptap/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { isBulletMarker } from "./bullet-editing";
import type { InlineTextStylePatch } from "./rich-text-selection";

export interface SlideTextSelectionOffsets {
  from: number;
  to: number;
}

export interface SlideRichTextEditorHandle {
  getEditor: () => Editor | null;
  getHTML: () => string;
  setSelectionFromRange: (range: Range | null) => boolean;
  setSelectionFromOffsets: (
    selection: SlideTextSelectionOffsets | null,
  ) => boolean;
  applyTextStyleToContent: (patch: InlineTextStylePatch) => void;
  applyTextStyle: (
    patch: InlineTextStylePatch,
    range: Range | null,
  ) => Range | null;
}

const CSS_STYLE_NAMES: Record<keyof InlineTextStylePatch, string> = {
  color: "color",
  fontFamily: "font-family",
  fontSize: "font-size",
  fontWeight: "font-weight",
  fontStyle: "font-style",
  textDecoration: "text-decoration",
  letterSpacing: "letter-spacing",
  lineHeight: "line-height",
};

/** Keep authored inline declarations when a selected text run is restyled. */
const SlideTextStyle = TextStyle.extend({
  name: "textStyle",
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      style: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("style"),
        renderHTML: (attributes: { style?: string | null }) =>
          attributes.style ? { style: attributes.style } : {},
      },
    };
  },
});

const SlideBlockStyle = Extension.create({
  name: "slideBlockStyle",
  addGlobalAttributes() {
    return [
      {
        types: [
          "blockquote",
          "bulletList",
          "codeBlock",
          "heading",
          "listItem",
          "orderedList",
          "paragraph",
        ],
        attributes: {
          style: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("style"),
            renderHTML: (attributes: { style?: string | null }) =>
              attributes.style ? { style: attributes.style } : {},
          },
        },
      },
    ];
  },
});

function mergeTextStyle(
  current: string | null | undefined,
  patch: InlineTextStylePatch,
  ownerDocument: Document,
): string | null {
  const styleElement = ownerDocument.createElement("span");
  if (current) styleElement.setAttribute("style", current);
  for (const [key, value] of Object.entries(patch) as Array<
    [keyof InlineTextStylePatch, string | undefined]
  >) {
    if (value !== undefined) {
      styleElement.style.setProperty(CSS_STYLE_NAMES[key], value);
    }
  }
  return styleElement.getAttribute("style");
}

function rangeInside(root: HTMLElement, range: Range): boolean {
  return (
    root.contains(range.startContainer) &&
    root.contains(range.endContainer) &&
    root.contains(range.commonAncestorContainer)
  );
}

function textPointAtOffset(
  root: HTMLElement,
  requestedOffset: number,
): [Node, number] {
  let remaining = Math.max(0, requestedOffset);
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  let lastText: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    lastText = text;
    if (remaining <= text.data.length) return [text, remaining];
    remaining -= text.data.length;
  }
  if (lastText) return [lastText, lastText.data.length];
  return [root, root.childNodes.length];
}

/** Capture a native selection before the selected DOM is replaced by TipTap. */
export function selectionOffsetsWithin(
  root: HTMLElement,
  range: Range,
): SlideTextSelectionOffsets {
  const offsetFor = (node: Node, offset: number) => {
    const prefix = root.ownerDocument.createRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(node, offset);
    return prefix.toString().length;
  };
  return {
    from: offsetFor(range.startContainer, range.startOffset),
    to: offsetFor(range.endContainer, range.endOffset),
  };
}

function isLegacyBulletRow(element: Element): boolean {
  return (
    element.tagName === "DIV" &&
    element.children.length >= 2 &&
    !!element.firstElementChild &&
    isBulletMarker(element.firstElementChild)
  );
}

function copyRowTextStyles(row: HTMLElement, item: HTMLElement): void {
  for (const property of [
    "color",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "letter-spacing",
    "line-height",
    "text-align",
    "text-decoration",
  ]) {
    const value = row.style.getPropertyValue(property);
    if (value) item.style.setProperty(property, value);
  }
}

/** Turn older styled bullet rows into a semantic list for editing. */
export function normalizeSlideEditorContent(html: string): string {
  if (!html || typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");

  const convert = (container: Element) => {
    const rows = Array.from(container.children).filter(isLegacyBulletRow);
    if (rows.length > 0 && rows.length === container.children.length) {
      const list = doc.createElement("ul");
      for (const row of rows) {
        const item = doc.createElement("li");
        const content = row.cloneNode(true) as HTMLElement;
        content.firstElementChild?.remove();
        item.innerHTML = content.innerHTML;
        copyRowTextStyles(row as HTMLElement, item);
        list.appendChild(item);
      }
      container.replaceChildren(list);
      return;
    }

    for (const child of Array.from(container.children)) convert(child);
  };

  convert(doc.body);
  return stripEditorOnlyTrailingParagraphs(doc.body.innerHTML);
}

function stripEditorOnlyTrailingParagraphs(html: string): string {
  if (!html || typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  while (
    doc.body.lastElementChild?.tagName === "P" &&
    !doc.body.lastElementChild.textContent?.trim()
  ) {
    doc.body.lastElementChild.remove();
  }
  return doc.body.innerHTML;
}

interface SlideRichTextEditorProps {
  value: string;
  initialSelection?: SlideTextSelectionOffsets | null;
  onChange: (html: string) => void;
  onEditorReady?: (editor: Editor) => void;
}

export const SlideRichTextEditor = forwardRef<
  SlideRichTextEditorHandle,
  SlideRichTextEditorProps
>(function SlideRichTextEditor(
  { value, initialSelection, onChange, onEditorReady },
  ref,
) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const selectionAppliedRef = useRef(false);
  const handleEditorReady = useCallback(
    (nextEditor: Editor) => setEditor(nextEditor),
    [],
  );

  useEffect(() => {
    if (editor && !editor.isDestroyed) onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  const setSelectionFromRange = useCallback(
    (range: Range | null) => {
      if (!editor || editor.isDestroyed) return false;
      if (range && !rangeInside(editor.view.dom, range)) return false;
      editor.commands.focus();
      if (!range) return true;
      try {
        const from = editor.view.posAtDOM(
          range.startContainer,
          range.startOffset,
        );
        const to = editor.view.posAtDOM(range.endContainer, range.endOffset);
        return editor.commands.setTextSelection({ from, to });
        // coercion-ok: a native range can be stale after the slide DOM is replaced.
      } catch {
        return false;
      }
    },
    [editor],
  );

  const setSelectionFromOffsets = useCallback(
    (selection: SlideTextSelectionOffsets | null) => {
      if (!editor || editor.isDestroyed || !selection) return false;
      const root = editor.view.dom;
      const [startNode, startOffset] = textPointAtOffset(root, selection.from);
      const [endNode, endOffset] = textPointAtOffset(root, selection.to);
      try {
        const from = editor.view.posAtDOM(startNode, startOffset);
        const to = editor.view.posAtDOM(endNode, endOffset);
        editor.commands.focus();
        return editor.commands.setTextSelection({ from, to });
      } catch {
        editor.commands.focus("end");
        return false;
      }
    },
    [editor],
  );

  useImperativeHandle(
    ref,
    () => ({
      getEditor: () => editor,
      getHTML: () =>
        stripEditorOnlyTrailingParagraphs(
          editor && !editor.isDestroyed
            ? editor.getHTML()
            : normalizeSlideEditorContent(value),
        ),
      setSelectionFromRange,
      setSelectionFromOffsets,
      applyTextStyleToContent: (patch) => {
        if (!editor || editor.isDestroyed) return;
        const { state } = editor;
        const markType = state.schema.marks.textStyle;
        if (!markType) return;
        const transaction = state.tr;
        state.doc.descendants((node, position) => {
          if (node.isText) {
            const current = node.marks.find((mark) => mark.type === markType)
              ?.attrs.style as string | null | undefined;
            const style = mergeTextStyle(
              current,
              patch,
              editor.view.dom.ownerDocument,
            );
            if (style) {
              transaction.addMark(
                position,
                position + node.nodeSize,
                markType.create({ style }),
              );
            }
            return;
          }

          if (node.type.name === "doc" || !node.isBlock) return;
          const current = node.attrs.style as string | null | undefined;
          const style = mergeTextStyle(
            current,
            patch,
            editor.view.dom.ownerDocument,
          );
          if (style) {
            transaction.setNodeMarkup(position, undefined, {
              ...node.attrs,
              style,
            });
          }
        });
        if (transaction.docChanged) editor.view.dispatch(transaction);
      },
      applyTextStyle: (patch, range) => {
        if (!editor || editor.isDestroyed) return null;
        if (range && !setSelectionFromRange(range)) return null;
        editor.commands.focus();

        const { state } = editor;
        const markType = state.schema.marks.textStyle;
        if (!markType) return null;
        const selection = state.selection;

        if (selection.empty) {
          const current = editor.getAttributes("textStyle") as {
            style?: string | null;
          };
          const style = mergeTextStyle(
            current.style,
            patch,
            editor.view.dom.ownerDocument,
          );
          if (!style) return null;
          editor.chain().focus().setMark("textStyle", { style }).run();
        } else {
          const transaction = state.tr;
          state.doc.nodesBetween(
            selection.from,
            selection.to,
            (node, position) => {
              if (!node.isText) return;
              const from = Math.max(selection.from, position);
              const to = Math.min(selection.to, position + node.nodeSize);
              if (from >= to) return;
              const current = node.marks.find((mark) => mark.type === markType)
                ?.attrs.style as string | null | undefined;
              const style = mergeTextStyle(
                current,
                patch,
                editor.view.dom.ownerDocument,
              );
              if (style) {
                transaction.addMark(from, to, markType.create({ style }));
              }
            },
          );
          if (transaction.docChanged) editor.view.dispatch(transaction);
        }

        const selectionAfter = window.getSelection();
        if (
          !selectionAfter ||
          selectionAfter.rangeCount !== 1 ||
          !rangeInside(editor.view.dom, selectionAfter.getRangeAt(0))
        ) {
          return null;
        }
        const nextRange = selectionAfter.getRangeAt(0).cloneRange();
        return nextRange.collapsed ? null : nextRange;
      },
    }),
    [editor, setSelectionFromOffsets, setSelectionFromRange, value],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed || selectionAppliedRef.current) return;
    let attempts = 0;
    let frame = 0;
    const applySelection = () => {
      if (editor.isDestroyed) return;
      if (initialSelection && setSelectionFromOffsets(initialSelection)) {
        selectionAppliedRef.current = true;
        return;
      }

      const walker = editor.view.dom.ownerDocument.createTreeWalker(
        editor.view.dom,
        NodeFilter.SHOW_TEXT,
      );
      let lastText: Text | null = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if ((node.textContent ?? "").trim()) lastText = node as Text;
      }
      if (lastText) {
        try {
          const position = editor.view.posAtDOM(lastText, lastText.data.length);
          editor.commands.focus();
          editor.commands.setTextSelection(position);
          selectionAppliedRef.current = true;
          return;
          // coercion-ok: the shared editor may still be applying its initial value.
        } catch {
          // The shared editor may still be applying its initial value.
        }
      }
      attempts += 1;
      if (attempts < 6) frame = requestAnimationFrame(applySelection);
      else {
        editor.chain().focus("end").run();
        selectionAppliedRef.current = true;
      }
    };
    frame = requestAnimationFrame(applySelection);
    return () => cancelAnimationFrame(frame);
  }, [editor, initialSelection, setSelectionFromOffsets]);

  return (
    <div className="slide-shared-rich-editor">
      <SharedRichEditor
        value={normalizeSlideEditorContent(value)}
        onChange={onChange}
        onEditorReady={handleEditorReady}
        dialect="gfm"
        preset="content"
        features={{
          codeBlock: false,
          markdown: false,
          placeholder: false,
          tables: false,
          tasks: false,
        }}
        dragHandle={false}
        placeholder=""
        className="slide-shared-rich-editor__surface"
        editorClassName="slide-shared-rich-editor__prose"
        ariaLabel="Slide text"
        getMarkdown={(currentEditor) =>
          stripEditorOnlyTrailingParagraphs(currentEditor.getHTML())
        }
        parseValue={false}
        normalizeValue={(nextValue) => nextValue}
        extraExtensions={[SlideTextStyle, SlideBlockStyle]}
      />
    </div>
  );
});

SlideRichTextEditor.displayName = "SlideRichTextEditor";
