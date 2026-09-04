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

const SLIDE_TEXT_CONTAINER_TAGS = new Set([
  "BLOCKQUOTE",
  "H1",
  "H2",
  "H3",
  "H4",
  "LI",
  "OL",
  "P",
  "UL",
]);

const SLIDE_EDITOR_BLOCK_ATTRIBUTES = ["dir", "data-pptx-paragraph"] as const;
const SLIDE_EDITOR_BLOCK_STYLE_PROPERTIES = [
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "line-height",
  "min-height",
  "text-align",
  "text-decoration",
] as const;

function syncSlideEditorBlockFormatting(
  source: HTMLElement,
  target: HTMLElement,
  clearMissing = false,
): void {
  const canRoundTripAttributes =
    target.tagName === "P" ||
    target.tagName === "LI" ||
    /^H[1-6]$/.test(target.tagName);
  for (const attributeName of SLIDE_EDITOR_BLOCK_ATTRIBUTES) {
    const value = source.getAttribute(attributeName);
    if (value !== null) target.setAttribute(attributeName, value);
    else if (clearMissing && canRoundTripAttributes) {
      target.removeAttribute(attributeName);
    }
  }
  for (const property of SLIDE_EDITOR_BLOCK_STYLE_PROPERTIES) {
    const value = source.style.getPropertyValue(property);
    if (value) {
      target.style.setProperty(
        property,
        value,
        source.style.getPropertyPriority(property),
      );
    } else if (clearMissing) {
      target.style.removeProperty(property);
    }
  }
}

export function isSlideTextContainerTag(tagName: string): boolean {
  return SLIDE_TEXT_CONTAINER_TAGS.has(tagName.toUpperCase());
}

/** Keep a semantic canvas element as the outer container around editor output. */
export function contentForSlideTextContainer(
  tagName: string,
  html: string,
  listTagName?: "OL" | "UL",
): string {
  if (
    !html ||
    !isSlideTextContainerTag(tagName) ||
    typeof DOMParser === "undefined"
  ) {
    return html;
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  const first = doc.body.firstElementChild;
  if (
    doc.body.children.length !== 1 ||
    first?.tagName.toUpperCase() !== tagName.toUpperCase()
  ) {
    return html;
  }
  if (/^H[1-6]$/.test(tagName.toUpperCase())) {
    const source = first as HTMLElement;
    const hasParagraphRoot =
      source.children.length === 1 && source.firstElementChild?.tagName === "P";
    const paragraph = hasParagraphRoot
      ? (source.firstElementChild!.cloneNode(true) as HTMLElement)
      : doc.createElement("p");
    if (!hasParagraphRoot) paragraph.innerHTML = source.innerHTML;
    syncSlideEditorBlockFormatting(source, paragraph);
    return paragraph.outerHTML;
  }
  if (tagName.toUpperCase() === "P") {
    const paragraph = doc.createElement("p");
    syncSlideEditorBlockFormatting(first as HTMLElement, paragraph);
    paragraph.innerHTML = first.innerHTML;
    return paragraph.outerHTML;
  }
  if (tagName.toUpperCase() === "LI") {
    const list = doc.createElement(listTagName === "OL" ? "ol" : "ul");
    const item = doc.createElement("li");
    syncSlideEditorBlockFormatting(first as HTMLElement, item);
    item.innerHTML = first.innerHTML;
    list.appendChild(item);
    return list.outerHTML;
  }
  if (["BLOCKQUOTE", "OL", "UL"].includes(tagName.toUpperCase())) {
    const wrapper = doc.createElement(tagName.toLowerCase());
    syncSlideEditorBlockFormatting(first as HTMLElement, wrapper);
    wrapper.innerHTML = first.innerHTML;
    return wrapper.outerHTML;
  }
  return first.innerHTML;
}

/** Keep a semantic canvas target valid when rich text changes its block root. */
export function restoreSlideTextContainerContent(
  element: HTMLElement,
  html: string,
  legacySourceHtml?: string,
): HTMLElement {
  html = restoreLegacyBulletRows(legacySourceHtml, html);
  if (!isSlideTextContainerTag(element.tagName)) {
    element.innerHTML = html;
    return element;
  }
  if (!html || typeof DOMParser === "undefined") {
    element.innerHTML = html;
    return element;
  }

  const nextDocument = new DOMParser().parseFromString(html, "text/html");
  const nextRoot = nextDocument.body.firstElementChild as HTMLElement | null;
  const nextChildren = Array.from(nextDocument.body.children);
  if (nextChildren.length === 1 && nextRoot?.tagName === element.tagName) {
    syncSlideEditorBlockFormatting(nextRoot, element, true);
    element.innerHTML = nextRoot.innerHTML;
    return element;
  }

  const nextListRoot =
    nextRoot && (nextRoot.tagName === "OL" || nextRoot.tagName === "UL")
      ? nextRoot
      : null;
  let parentList =
    element.tagName === "LI" &&
    (element.parentElement?.tagName === "OL" ||
      element.parentElement?.tagName === "UL")
      ? element.parentElement
      : null;
  if (
    parentList &&
    nextListRoot &&
    parentList.tagName !== nextListRoot.tagName
  ) {
    const replacement = element.ownerDocument.createElement(
      nextListRoot.tagName.toLowerCase(),
    );
    for (const attribute of Array.from(parentList.attributes)) {
      replacement.setAttribute(attribute.name, attribute.value);
    }
    while (parentList.firstChild) {
      replacement.appendChild(parentList.firstChild);
    }
    parentList.replaceWith(replacement);
    parentList = replacement;
  }

  const content = contentForSlideTextContainer(element.tagName, html);
  if (content !== html) {
    element.innerHTML = content;
    return element;
  }

  const nextListItemRoot =
    element.tagName === "LI" &&
    nextListRoot !== null &&
    nextListRoot.children.length === 1 &&
    nextListRoot.firstElementChild?.tagName === "LI"
      ? (nextListRoot.firstElementChild as HTMLElement)
      : null;
  const hasMultipleListItems =
    element.tagName === "LI" &&
    nextListRoot !== null &&
    nextListRoot.children.length > 1 &&
    Array.from(nextListRoot.children).every((child) => child.tagName === "LI");
  const preservesListItemRoot =
    element.tagName === "LI" &&
    !hasMultipleListItems &&
    (nextListItemRoot !== null ||
      (nextChildren.length > 0 &&
        nextChildren.every((child) =>
          ["OL", "P", "UL"].includes(child.tagName),
        )));
  const preservesListRoot =
    (element.tagName === "UL" || element.tagName === "OL") &&
    nextRoot !== null &&
    ["OL", "UL"].includes(nextRoot.tagName) &&
    nextRoot.children.length > 0 &&
    Array.from(nextRoot.children).every((child) => child.tagName === "LI");
  const preservesRoot = preservesListItemRoot || preservesListRoot;
  if (
    nextChildren.length === 1 &&
    /^H[1-6]$/.test(element.tagName) &&
    nextRoot?.tagName === "P"
  ) {
    syncSlideEditorBlockFormatting(nextRoot, element, true);
    element.innerHTML = nextRoot.innerHTML;
    return element;
  }
  if (preservesRoot) {
    if (preservesListRoot && nextRoot?.tagName !== element.tagName) {
      const replacement = element.ownerDocument.createElement(
        nextRoot.tagName.toLowerCase(),
      );
      for (const attribute of Array.from(element.attributes)) {
        replacement.setAttribute(attribute.name, attribute.value);
      }
      syncSlideEditorBlockFormatting(nextRoot, replacement, true);
      replacement.innerHTML = nextRoot.innerHTML;
      element.replaceWith(replacement);
      return replacement;
    }
    if (element.tagName === "LI" && nextChildren[0]?.tagName === "P") {
      syncSlideEditorBlockFormatting(
        nextChildren[0] as HTMLElement,
        element,
        true,
      );
    }
    if (nextListItemRoot) {
      syncSlideEditorBlockFormatting(nextListItemRoot, element, true);
      element.innerHTML = nextListItemRoot.innerHTML;
      return element;
    }
    element.innerHTML = html;
    return element;
  }

  if (hasMultipleListItems && parentList && nextListRoot) {
    const firstItem = nextListRoot.firstElementChild as HTMLElement;
    syncSlideEditorBlockFormatting(firstItem, element, true);
    element.innerHTML = firstItem.innerHTML;
    const insertBefore = element.nextSibling;
    for (const item of Array.from(nextListRoot.children).slice(1)) {
      parentList.insertBefore(item.cloneNode(true), insertBefore);
    }
    return element;
  }

  const replacement = element.ownerDocument.createElement("div");
  for (const attribute of Array.from(element.attributes)) {
    replacement.setAttribute(attribute.name, attribute.value);
  }
  if (element.tagName === "UL" || element.tagName === "OL") {
    if (nextRoot?.tagName !== "UL" && nextRoot?.tagName !== "OL") {
      for (const property of [
        "list-style",
        "list-style-position",
        "list-style-type",
        "padding-left",
      ]) {
        replacement.style.removeProperty(property);
      }
    }
  }
  replacement.innerHTML = html;
  element.replaceWith(replacement);
  return replacement;
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
      {
        types: ["listItem", "paragraph"],
        attributes: {
          "data-pptx-paragraph": {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute("data-pptx-paragraph"),
            renderHTML: (attributes: {
              "data-pptx-paragraph"?: string | null;
            }) =>
              attributes["data-pptx-paragraph"] === null ||
              attributes["data-pptx-paragraph"] === undefined
                ? {}
                : { "data-pptx-paragraph": attributes["data-pptx-paragraph"] },
          },
          dir: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("dir"),
            renderHTML: (attributes: { dir?: string | null }) =>
              attributes.dir ? { dir: attributes.dir } : {},
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
    const point = root.ownerDocument.createRange();
    point.setStart(node, offset);
    point.collapse(true);
    const walker = root.ownerDocument.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
    );
    let total = 0;
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const textNode = text as Text;
      if (isRemovedLegacyBulletText(root, textNode)) continue;
      if (textNode === node) return total + Math.min(offset, textNode.length);
      const textRange = root.ownerDocument.createRange();
      textRange.selectNodeContents(textNode);
      if (point.compareBoundaryPoints(Range.START_TO_END, textRange) >= 0) {
        total += textNode.length;
        continue;
      }
      break;
    }
    return total;
  };
  return {
    from: offsetFor(range.startContainer, range.startOffset),
    to: offsetFor(range.endContainer, range.endOffset),
  };
}

function isLegacyBulletRow(element: Element): boolean {
  return (
    (element.tagName === "DIV" || element.tagName === "P") &&
    !!element.firstElementChild &&
    isBulletMarker(element.firstElementChild)
  );
}

function isRemovedLegacyBulletText(root: HTMLElement, node: Text): boolean {
  let element = node.parentElement;
  while (element && element !== root) {
    if (
      isLegacyBulletRow(element) &&
      element.firstElementChild?.contains(node)
    ) {
      return true;
    }
    element = element.parentElement;
  }
  return false;
}

const LEGACY_ROW_TEXT_STYLE_PROPERTIES = [
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "line-height",
  "text-align",
  "text-decoration",
];

function listItemContent(item: HTMLElement): string {
  const firstChild = item.firstElementChild;
  return item.children.length === 1 && firstChild?.tagName === "P"
    ? firstChild.innerHTML
    : item.innerHTML;
}

function restoreLegacyBulletRow(
  template: HTMLElement,
  item: HTMLElement,
): HTMLElement {
  const row = template.cloneNode(true) as HTMLElement;
  const marker = row.firstElementChild;
  if (!marker) return row;

  while (marker.nextSibling) marker.nextSibling.remove();

  const textTemplate = template.children[1];
  const content = listItemContent(item);
  if (textTemplate) {
    const text = textTemplate.cloneNode(false) as HTMLElement;
    text.innerHTML = content;
    row.appendChild(text);
  } else {
    row.insertAdjacentHTML("beforeend", content);
  }

  for (const attribute of Array.from(item.attributes)) {
    if (attribute.name !== "style") {
      row.setAttribute(attribute.name, attribute.value);
    }
  }
  for (const property of LEGACY_ROW_TEXT_STYLE_PROPERTIES) {
    row.style.removeProperty(property);
  }
  copyRowTextStyles(item, row);
  return row;
}

function restoreLegacyBulletRowsInContainer(
  source: Element,
  current: Element,
): void {
  const sourceChildren = Array.from(source.children);
  let currentIndex = 0;

  for (let sourceIndex = 0; sourceIndex < sourceChildren.length; ) {
    const sourceChild = sourceChildren[sourceIndex];
    if (isLegacyBulletRow(sourceChild)) {
      const templates: HTMLElement[] = [];
      while (
        sourceIndex < sourceChildren.length &&
        isLegacyBulletRow(sourceChildren[sourceIndex])
      ) {
        templates.push(sourceChildren[sourceIndex] as HTMLElement);
        sourceIndex += 1;
      }

      const currentChild = current.children[currentIndex];
      if (currentChild?.tagName === "UL") {
        const items = Array.from(currentChild.children).filter(
          (child): child is HTMLElement => child.tagName === "LI",
        );
        const hasNestedList = items.some((item) =>
          Array.from(item.children).some(
            (child) => child.tagName === "UL" || child.tagName === "OL",
          ),
        );
        if (!hasNestedList && items.length > 0) {
          const rows = items.map((item, index) =>
            restoreLegacyBulletRow(
              templates[Math.min(index, templates.length - 1)],
              item,
            ),
          );
          currentChild.replaceWith(...rows);
          currentIndex += rows.length;
          continue;
        }
      }
      currentIndex += 1;
      continue;
    }

    const currentChild = current.children[currentIndex];
    if (currentChild && currentChild.tagName === sourceChild.tagName) {
      restoreLegacyBulletRowsInContainer(sourceChild, currentChild);
    }
    sourceIndex += 1;
    currentIndex += 1;
  }
}

function restoreLegacyBulletRows(
  sourceHtml: string | undefined,
  html: string,
): string {
  if (
    !sourceHtml ||
    !html ||
    typeof DOMParser === "undefined" ||
    !sourceHtml.includes("<")
  ) {
    return html;
  }
  const sourceDocument = new DOMParser().parseFromString(
    sourceHtml,
    "text/html",
  );
  const currentDocument = new DOMParser().parseFromString(html, "text/html");
  restoreLegacyBulletRowsInContainer(sourceDocument.body, currentDocument.body);
  return currentDocument.body.innerHTML;
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
    const children = Array.from(container.children);
    const rows = children.filter(isLegacyBulletRow);
    if (rows.length > 0) {
      const converted: Element[] = [];
      let list: HTMLUListElement | null = null;
      for (const child of children) {
        if (isLegacyBulletRow(child)) {
          if (!list) {
            list = doc.createElement("ul");
            converted.push(list);
          }
          const item = doc.createElement("li");
          const content = child.cloneNode(true) as HTMLElement;
          content.firstElementChild?.remove();
          item.innerHTML = content.innerHTML;
          for (const attribute of Array.from(child.attributes)) {
            if (attribute.name !== "style") {
              item.setAttribute(attribute.name, attribute.value);
            }
          }
          copyRowTextStyles(child as HTMLElement, item);
          list.appendChild(item);
        } else {
          list = null;
          converted.push(child);
        }
      }
      container.replaceChildren(...converted);
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
    doc.body.lastElementChild.attributes.length === 0 &&
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
