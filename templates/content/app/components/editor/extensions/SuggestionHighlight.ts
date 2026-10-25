import { RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION } from "@agent-native/toolkit/editor";
import { canonicalizeNfm, docToNfm } from "@shared/nfm";
import { suggestionFormattingSourceRange } from "@shared/suggestion-formatting";
import {
  resolveMarkdownSuggestionRange,
  resolveMarkdownSuggestionRangeInContext,
} from "@shared/suggestion-rebase";
import {
  suggestionTextPresentationForSource,
  suggestionTextPresentation,
  type SuggestionPresentationContext,
  type SuggestionPresentationNode,
} from "@shared/suggestion-text";
import { Extension } from "@tiptap/core";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Selection,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import { buildDocText } from "../comment-anchors";

export type SuggestionHighlightKind =
  | "delete"
  | "replace"
  | "insert"
  | "add_block"
  | "mark";

export interface SuggestionHighlightSpec {
  suggestionId: string;
  kind: SuggestionHighlightKind;
  from: number;
  to: number;
  insertedText?: string;
  deletedText?: string;
  insertedPresentation?: SuggestionPresentationContext;
  deletedPresentation?: SuggestionPresentationContext;
  editableBoundary?: boolean;
  editableText?: boolean;
  settling?: boolean;
  /** Accepted but not saved yet, drawn as a suggestion: its words hold still. */
  frozen?: boolean;
  settlingBeforePresentation?: SuggestionPresentationContext;
  settlingAfterSource?: string;
  settlingReadbackContent?: string | null;
}

export interface SuggestionHighlightState {
  specs: SuggestionHighlightSpec[];
  activeId: string | null;
  decorations: DecorationSet;
}

export interface SuggestionHighlightMeta {
  specs?: SuggestionHighlightSpec[];
  activeId?: string | null;
}

export const suggestionHighlightKey = new PluginKey<SuggestionHighlightState>(
  "suggestionHighlight",
);

interface Range {
  from: number;
  to: number;
}

function clampRange(from: number, to: number, size: number): Range | null {
  const start = Math.max(0, Math.min(from, size));
  const end = Math.max(0, Math.min(to, size));
  return end > start ? { from: start, to: end } : null;
}

function clampPosition(position: number, size: number): number {
  return Math.max(0, Math.min(position, size));
}

function classes(base: string, active: boolean): string {
  return active ? `${base} suggestion-highlight--active` : base;
}

function appendPresentationNode(
  parent: HTMLElement,
  node: SuggestionPresentationNode,
  showLinkDestination: boolean,
): void {
  if (node.type === "lineBreak") {
    parent.append(document.createElement("br"));
    return;
  }
  if (node.type === "text" || node.type === "indent" || node.type === "block") {
    parent.append(document.createTextNode(node.value));
    return;
  }

  const element = document.createElement(
    node.type === "strong"
      ? "strong"
      : node.type === "emphasis"
        ? "em"
        : node.type === "strike"
          ? "s"
          : node.type === "underline"
            ? "u"
            : node.type === "code"
              ? "code"
              : "span",
  );
  if (node.type === "code") {
    element.className = "rounded bg-muted px-1 font-mono text-[0.9em]";
  } else if (node.type === "link") {
    element.className = "underline underline-offset-2";
  }
  for (const child of node.children)
    appendPresentationNode(element, child, showLinkDestination);
  parent.append(element);

  if (node.type === "link" && showLinkDestination) {
    parent.append(document.createTextNode(` (${node.url})`));
  }
}

function appendSuggestionText(
  parent: HTMLElement,
  content: string,
  context?: SuggestionPresentationContext,
  showLinkDestination = true,
): void {
  const nodes = context
    ? suggestionTextPresentationForSource(content, context)
    : suggestionTextPresentation(content);
  if (!nodes) return;
  for (const node of nodes) {
    appendPresentationNode(parent, node, showLinkDestination);
  }
}

// While the reader can type, a click on suggested text that isn't in the
// document places the caret where the widget sits instead of focusing it.
// `control` takes the button role when the widget itself has a role to keep.
function identifyWidget(
  widget: HTMLElement,
  spec: SuggestionHighlightSpec,
  label: string,
  position = spec.from,
  control = widget,
) {
  widget.setAttribute("data-suggestion-id", spec.suggestionId);
  widget.setAttribute("data-suggestion-widget", "true");
  if (spec.editableBoundary) {
    widget.setAttribute("data-suggestion-edit-boundary", "true");
    widget.setAttribute("data-suggestion-position", String(position));
  } else {
    control.setAttribute("role", "button");
    control.setAttribute("tabindex", "0");
    control.setAttribute("aria-label", label);
  }
}

function insertionClass(spec: SuggestionHighlightSpec) {
  return `${
    spec.kind === "add_block" ? "suggestion-add-block" : "suggestion-insert"
  } suggestion-proposed-text`;
}

function insertionWidget(
  spec: SuggestionHighlightSpec,
  active: boolean,
  part?: { text: string; context?: SuggestionPresentationContext },
  position?: number,
) {
  return () => {
    const widget = document.createElement("span");
    if (spec.settling) {
      widget.className = "suggestion-settling-text suggestion-inline-widget";
      widget.setAttribute("data-suggestion-widget", "true");
      appendSuggestionText(
        widget,
        spec.insertedText ?? "",
        spec.insertedPresentation,
        false,
      );
      return widget;
    }
    widget.className = classes(
      `${insertionClass(spec)} suggestion-inline-widget`,
      active,
    );
    identifyWidget(widget, spec, "Inspect suggested insertion", position);
    appendSuggestionText(
      widget,
      part ? part.text : (spec.insertedText ?? ""),
      part ? part.context : spec.insertedPresentation,
    );
    return widget;
  };
}

function deletionWidget(
  spec: SuggestionHighlightSpec,
  active: boolean,
  part?: { text: string; context?: SuggestionPresentationContext },
) {
  return () => {
    const widget = document.createElement("span");
    widget.className = classes(
      "suggestion-delete-widget suggestion-deleted-text suggestion-inline-widget",
      active,
    );
    identifyWidget(widget, spec, "Inspect suggested deletion");
    appendSuggestionText(
      widget,
      part ? part.text : (spec.deletedText ?? ""),
      part ? part.context : spec.deletedPresentation,
    );
    return widget;
  };
}

const documentSources = new WeakMap<ProseMirrorNode, string>();

/** The editor document's Markdown, serialized once per immutable document. */
export function editorDocumentSource(doc: ProseMirrorNode): string {
  let source = documentSources.get(doc);
  if (source === undefined) {
    source = docToNfm(doc.toJSON());
    documentSources.set(doc, source);
  }
  return source;
}

type SourceSpan = { from: number; to: number };

// How suggested text with line breaks meets the lines around it: the part
// that joins the line before the point, the whole lines it adds or removes,
// and the part that joins the line after.
interface SuggestedLines {
  source: string;
  head: SourceSpan | null;
  lines: SourceSpan[];
  tail: SourceSpan | null;
  side: "before" | "after";
}

function suggestedLines(
  text: string | undefined,
  context: SuggestionPresentationContext | undefined,
): SuggestedLines | null {
  if (!text || !context || !text.includes("\n")) return null;
  const { source, from, to } = context;
  if (source.slice(from, to) !== text) return null;
  const startsLine = from === 0 || source[from - 1] === "\n";
  const endsLine = to === source.length || source[to] === "\n";
  // Text that splits a line in two has no whole line to show on its own.
  if (!startsLine && !endsLine) return null;
  const spans: SourceSpan[] = [];
  let start = from;
  for (let index = from; index < to; index += 1) {
    if (source[index] !== "\n") continue;
    spans.push({ from: start, to: index });
    start = index + 1;
  }
  spans.push({ from: start, to });
  const head = startsLine ? null : spans.shift()!;
  const tail = endsLine ? null : spans.pop()!;
  const lines = spans.filter((span) => span.to > span.from);
  if (!lines.length) return null;
  return {
    source,
    head: head && head.to > head.from ? head : null,
    lines,
    tail: tail && tail.to > tail.from ? tail : null,
    side: startsLine ? "before" : "after",
  };
}

const LIST_LINE = /^\t*(?:[-*+] (\[[ xX]\] )?|(\d+)[.)] )/;
const LIST = /^(?:bulletList|orderedList|taskList)$/;

// Where a whole line belongs: how far it is indented, and the kind of list
// it adds an item to, if it is a list item.
interface LineShape {
  indent: number;
  list: string | null;
}

function lineShape(text: string): LineShape {
  const list = LIST_LINE.exec(text);
  return {
    indent: /^\t*/.exec(text)![0].length,
    list: !list
      ? null
      : list[1]
        ? "taskList"
        : list[2]
          ? "orderedList"
          : "bulletList",
  };
}

// The document position beside the block at `point` where a whole line
// goes: out of the containers the point sits at the edge of, but no further
// than the line's indentation allows, and into a list only of its own kind.
// A line that can't be placed as written has no position.
function lineBoundary(
  doc: ProseMirrorNode,
  point: number,
  side: "before" | "after",
  shape: LineShape,
): { position: number; inList: boolean } | null {
  if (point < 0 || point > doc.content.size) return null;
  const $point = doc.resolve(point);
  // Lines added to code are code text, not blocks of their own.
  if (
    !$point.parent.isTextblock ||
    $point.parent.type.spec.code ||
    $point.parentOffset !== (side === "before" ? 0 : $point.parent.content.size)
  )
    return null;
  // A Page indents a block one tab per block it sits in; a list's items
  // indent their children, so the list itself adds none.
  const indentInside = (depth: number) => {
    let indent = 0;
    for (let level = 1; level <= depth; level += 1) {
      const node = $point.node(level);
      indent += LIST.test(node.type.name) ? 0 : 1;
      indent += Number(node.attrs.indent) || 0;
    }
    return indent;
  };
  let depth = $point.depth;
  while (depth > 1) {
    const container = $point.node(depth - 1);
    if (
      container.type.name === shape.list &&
      indentInside(depth - 1) === shape.indent
    )
      break;
    const index = $point.index(depth - 1);
    if (side === "before" ? index !== 0 : index !== container.childCount - 1)
      break;
    if (indentInside(depth - 2) < shape.indent) break;
    depth -= 1;
  }
  const container = $point.node(depth - 1);
  const inList = LIST.test(container.type.name);
  if (
    indentInside(depth - 1) !== shape.indent ||
    (inList && container.type.name !== shape.list)
  )
    return null;
  return {
    position: side === "before" ? $point.before(depth) : $point.after(depth),
    inList,
  };
}

// A whole suggested line drawn as the block it would become.
function lineWidget(
  spec: SuggestionHighlightSpec,
  active: boolean,
  className: string,
  label: string,
  text: string,
  nodes: SuggestionPresentationNode[],
  inList: boolean,
) {
  return () => {
    const list = LIST_LINE.exec(text);
    const heading = /^\t*(#{1,6}) /.exec(text);
    const quote = /^\t*> /.test(text);
    const widget = document.createElement(inList ? "li" : "div");
    widget.className = classes(`${className} suggestion-block-widget`, active);
    const block = document.createElement(
      heading ? `h${heading[1]!.length}` : "p",
    );
    if (list?.[1])
      block.append(document.createTextNode(/x/i.test(list[1]) ? "☑ " : "☐ "));
    // The element and where it sits show the line's structure, so its
    // indentation and marker aren't repeated; an empty paragraph keeps its
    // pilcrow so the line can be seen.
    for (const node of nodes)
      if (
        node.type !== "indent" &&
        (node.type !== "block" || node.value === "¶")
      )
        appendPresentationNode(block, node, true);
    let content: HTMLElement = block;
    if (quote) {
      content = document.createElement("blockquote");
      content.append(block);
    }
    if (list && !inList) {
      const item = document.createElement("li");
      item.append(content);
      content = document.createElement(list[2] ? "ol" : "ul");
      // Each line is its own list, so a numbered line keeps its number.
      if (list[2]) content.setAttribute("start", list[2]);
      content.append(item);
    }
    widget.append(content);
    // An item in a list stays a list item to assistive tech; its content is
    // the button.
    identifyWidget(widget, spec, label, undefined, inList ? content : widget);
    return widget;
  };
}

// Whole suggested lines go beside the block at the point, in order; the
// parts that join a line stay inline at the point.
function lineDecorations(
  doc: ProseMirrorNode,
  spec: SuggestionHighlightSpec,
  active: boolean,
  lines: SuggestedLines,
  deleted: boolean,
  attrs: Record<string, string>,
): Decoration[] | null {
  const className = deleted
    ? "suggestion-delete-widget suggestion-deleted-text"
    : insertionClass(spec);
  const label = deleted
    ? "Inspect suggested deletion"
    : "Inspect suggested insertion";
  const placed = lines.lines.map((line) => {
    const text = lines.source.slice(line.from, line.to);
    return {
      line,
      boundary: lineBoundary(doc, spec.from, lines.side, lineShape(text)),
      nodes: suggestionTextPresentationForSource(text, {
        source: lines.source,
        ...line,
      }),
    };
  });
  if (placed.some(({ boundary, nodes }) => !boundary || !nodes)) return null;
  const decorations: Decoration[] = [];
  const inline = (span: SourceSpan | null, part: "head" | "tail") => {
    if (!span) return;
    const text = lines.source.slice(span.from, span.to);
    const context = { source: lines.source, ...span };
    decorations.push(
      Decoration.widget(
        spec.from,
        deleted
          ? deletionWidget(spec, active, { text, context })
          : insertionWidget(spec, active, { text, context }),
        {
          key: JSON.stringify([
            spec.suggestionId,
            part,
            spec.from,
            text,
            active,
            !!spec.editableBoundary,
          ]),
          marks: [],
          side: part === "head" ? 1 : 2,
          ...attrs,
        },
      ),
    );
  };
  inline(lines.head, "head");
  placed.forEach(({ line, boundary, nodes }, index) => {
    decorations.push(
      Decoration.widget(
        boundary!.position,
        lineWidget(
          spec,
          active,
          className,
          label,
          lines.source.slice(line.from, line.to),
          nodes!,
          boundary!.inList,
        ),
        {
          key: JSON.stringify([
            spec.suggestionId,
            deleted ? "deleted-line" : "inserted-line",
            boundary!.position,
            lines.source.slice(line.from, line.to),
            boundary!.inList,
            active,
            !!spec.editableBoundary,
          ]),
          marks: [],
          side: lines.side === "before" ? index - placed.length : index + 1,
          ...attrs,
        },
      ),
    );
  });
  inline(lines.tail, "tail");
  return decorations;
}

// Whole blocks a saved deletion removes are marked as blocks, so the
// paragraph itself reads as removed rather than only its text.
function deletedBlockDecorations(
  doc: ProseMirrorNode,
  range: Range,
  active: boolean,
): Decoration[] {
  const decorations: Decoration[] = [];
  doc.nodesBetween(range.from, range.to, (node, position) => {
    if (!node.isTextblock) return true;
    const contentFrom = position + 1;
    const contentTo = position + 1 + node.content.size;
    if (
      node.content.size > 0 &&
      range.from <= contentFrom &&
      range.to >= contentTo
    )
      decorations.push(
        Decoration.node(position, position + node.nodeSize, {
          class: classes("suggestion-delete-block", active),
        }),
      );
    return false;
  });
  return decorations;
}

function insertionAtOperationAnchor(
  doc: ProseMirrorNode,
  from: number,
  inserted: string | undefined,
) {
  return Boolean(
    inserted &&
    from >= 0 &&
    from + inserted.length <= doc.content.size &&
    doc.textBetween(from, from + inserted.length) === inserted,
  );
}

function anchoredNfmMatches(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  expectedSource: string,
): boolean {
  const range = clampRange(from, to, doc.content.size);
  const { paragraph, doc: documentNode } = doc.type.schema.nodes;
  if (!range || !paragraph || !documentNode) return false;
  const selected = doc.slice(range.from, range.to);
  if (selected.content.content.some((node) => !node.isText)) return false;
  const isolatedDocument = documentNode.create(
    null,
    paragraph.create(null, selected.content),
  );
  return (
    canonicalizeNfm(docToNfm(isolatedDocument.toJSON())) ===
    canonicalizeNfm(expectedSource)
  );
}

export function acceptedSuggestionAtRange(
  doc: ProseMirrorNode,
  mounted: Range,
  before: SuggestionPresentationContext,
  after: SuggestionPresentationContext,
): boolean {
  const source = editorDocumentSource(doc);
  const beforeText = before.source.slice(before.from, before.to);
  const afterText = after.source.slice(after.from, after.to);
  const operation = (
    original: SuggestionPresentationContext,
    proposed: SuggestionPresentationContext,
  ) => ({
    before: {
      markdown: original.source,
      changedText: original.source.slice(original.from, original.to),
    },
    after: {
      markdown: proposed.source,
      changedText: proposed.source.slice(proposed.from, proposed.to),
    },
    anchor: {
      from: original.from,
      to: original.to,
      prefix: original.source.slice(
        Math.max(0, original.from - 32),
        original.from,
      ),
      suffix: original.source.slice(original.to, original.to + 32),
    },
  });
  if (
    beforeText === afterText ||
    (beforeText &&
      resolveMarkdownSuggestionRange(source, operation(before, after)))
  )
    return false;
  const accepted = resolveMarkdownSuggestionRangeInContext(
    source,
    operation(after, before),
  );
  if (!accepted) return false;
  const mapped = suggestionFormattingSourceRange(
    source,
    accepted.from,
    accepted.to,
  );
  if (!mapped || mapped.text !== buildDocText(doc).text) return false;
  const from = doc.textBetween(0, mounted.from, "").length;
  const to = doc.textBetween(0, mounted.to, "").length;
  // Insertions map to the accepted span's end when canonical text arrives.
  return before.from === before.to
    ? from === mapped.from || from === mapped.to
    : Math.min(from, to) === mapped.from && Math.max(from, to) === mapped.to;
}

function settledAtOperation(
  doc: ProseMirrorNode,
  spec: SuggestionHighlightSpec,
) {
  const presentation = spec.insertedPresentation;
  if (!presentation) return false;
  const before = spec.settlingBeforePresentation;
  if (before && acceptedSuggestionAtRange(doc, spec, before, presentation))
    return true;
  if (spec.kind === "insert")
    return insertionAtOperationAnchor(doc, spec.from, spec.insertedText);
  if (spec.kind !== "delete" && spec.kind !== "replace") return false;
  if (!before) return false;
  if (spec.kind === "replace")
    return anchoredNfmMatches(doc, spec.from, spec.to, spec.insertedText ?? "");
  const removed = before.source.slice(before.from, before.to);
  if (
    removed &&
    doc.textBetween(spec.from, spec.from + removed.length) === removed
  )
    return false;
  const right = presentation.source.slice(
    presentation.from,
    presentation.from + 32,
  );
  if (right)
    return doc.textBetween(spec.from, spec.from + right.length) === right;
  const left = presentation.source.slice(
    Math.max(0, presentation.from - 32),
    presentation.from,
  );
  return Boolean(
    left &&
    spec.from >= left.length &&
    doc.textBetween(spec.from - left.length, spec.from) === left,
  );
}

function buildDecorations(
  doc: ProseMirrorNode,
  specs: SuggestionHighlightSpec[],
  activeId: string | null,
): DecorationSet {
  const decorations: Decoration[] = [];
  const size = doc.content.size;
  const canonicalContent = new Map<string, string>();
  const canonicalizeContent = (content: string) => {
    const canonical = canonicalContent.get(content);
    if (canonical !== undefined) return canonical;
    const normalized = canonicalizeNfm(content);
    canonicalContent.set(content, normalized);
    return normalized;
  };
  const settledContent = specs.some((spec) => spec.settling)
    ? canonicalizeContent(editorDocumentSource(doc))
    : null;

  for (const spec of specs) {
    if (
      spec.settling &&
      settledContent !== null &&
      ((spec.insertedPresentation !== undefined &&
        settledContent ===
          canonicalizeContent(spec.insertedPresentation.source)) ||
        settledAtOperation(doc, spec) ||
        (spec.settlingReadbackContent !== null &&
          spec.settlingReadbackContent !== undefined &&
          settledContent === canonicalizeContent(spec.settlingReadbackContent)))
    )
      continue;
    const active = activeId === spec.suggestionId;
    const range = clampRange(spec.from, spec.to, size);
    const attrs = spec.settling
      ? {}
      : {
          "data-suggestion-id": spec.suggestionId,
          ...(spec.editableText
            ? {}
            : {
                role: "button",
                tabindex: "0",
                "aria-label": "Inspect suggested change",
              }),
        };

    if (spec.settling) {
      if (range && range.to > range.from) {
        decorations.push(
          Decoration.inline(range.from, range.to, {
            class: "suggestion-settling-original",
          }),
        );
      }
      if (spec.kind !== "delete") {
        decorations.push(
          Decoration.widget(
            clampPosition(range ? range.to : spec.from, size),
            insertionWidget(spec, false),
            {
              key: JSON.stringify([
                spec.suggestionId,
                "settling",
                range?.from ?? spec.from,
                range?.to ?? spec.from,
                spec.insertedText,
                spec.insertedPresentation?.from,
                spec.insertedPresentation?.to,
              ]),
              marks: [],
              side: 1,
            },
          ),
        );
      }
      continue;
    }

    if (spec.kind === "delete" || spec.kind === "replace") {
      if (range) {
        decorations.push(
          Decoration.inline(range.from, range.to, {
            ...attrs,
            class: classes("suggestion-delete suggestion-deleted-text", active),
          }),
        );
        if (spec.kind === "delete")
          decorations.push(...deletedBlockDecorations(doc, range, active));
      }
    } else if (spec.kind === "mark" && range) {
      decorations.push(
        Decoration.inline(range.from, range.to, {
          ...attrs,
          class: classes("suggestion-change suggestion-proposed-text", active),
        }),
      );
    }

    if (
      spec.kind === "replace" ||
      spec.kind === "insert" ||
      spec.kind === "add_block"
    ) {
      const lines =
        spec.kind === "replace"
          ? null
          : suggestedLines(spec.insertedText, spec.insertedPresentation);
      const lineParts =
        lines && lineDecorations(doc, spec, active, lines, false, attrs);
      const anchor = clampPosition(
        spec.kind === "replace" && range ? range.to : spec.from,
        size,
      );
      if (lineParts) decorations.push(...lineParts);
      else
        decorations.push(
          Decoration.widget(
            anchor,
            insertionWidget(spec, active, undefined, anchor),
            {
              // ProseMirror reuses a widget's element while its key holds, so
              // the key covers everything the element shows.
              key: `${spec.suggestionId}:inserted:${anchor}:${JSON.stringify([
                spec.insertedText,
                active,
                !!spec.editableBoundary,
              ])}`,
              marks: [],
              side: 1,
              ...attrs,
            },
          ),
        );
    }
    const deletedLines =
      spec.deletedText &&
      suggestedLines(spec.deletedText, spec.deletedPresentation);
    const deletedLineParts =
      deletedLines &&
      lineDecorations(doc, spec, active, deletedLines, true, attrs);
    if (deletedLineParts) decorations.push(...deletedLineParts);
    else if (spec.deletedText) {
      decorations.push(
        Decoration.widget(
          clampPosition(spec.from, size),
          deletionWidget(spec, active),
          {
            key: JSON.stringify([
              spec.suggestionId,
              "deleted",
              clampPosition(spec.from, size),
              spec.deletedText,
              active,
              !!spec.editableBoundary,
            ]),
            marks: [],
            side: 1,
            ...attrs,
          },
        ),
      );
    }
  }

  return DecorationSet.create(doc, decorations);
}

/**
 * Whether a local edit touches words an accepted suggestion is replacing.
 * They stay fixed until the server's change arrives over live sync, so a
 * keystroke can't land in text that's about to be replaced.
 */
export function editsSettlingSuggestion(
  transaction: Transaction,
  specs: readonly SuggestionHighlightSpec[],
): boolean {
  if (
    !transaction.docChanged ||
    isChangeOrigin(transaction) ||
    transaction.getMeta(RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION) ||
    transaction.getMeta("addToHistory") === false
  )
    return false;
  let ranges = specs
    .filter((spec) => spec.settling || spec.frozen)
    .map(({ from, to }) => ({ from, to }));
  for (const step of transaction.steps) {
    if (ranges.length === 0) return false;
    const touched: Array<{ from: number; to: number }> = [];
    const { from, to } = step as { from?: unknown; to?: unknown };
    if (typeof from === "number" && typeof to === "number")
      touched.push({ from, to });
    const map = step.getMap();
    map.forEach((oldStart, oldEnd) =>
      touched.push({ from: oldStart, to: oldEnd }),
    );
    // Typing right beside the words leaves them as reviewed; if a letter joins
    // them, the server turns the accept down instead. A point has no inside,
    // so typing exactly there waits.
    if (
      touched.some((edit) =>
        ranges.some((range) =>
          range.from === range.to
            ? edit.from <= range.to && edit.to >= range.from
            : edit.from < range.to && edit.to > range.from,
        ),
      )
    )
      return true;
    ranges = ranges.map((range) => ({
      from: map.map(range.from, 1),
      to: map.map(range.to, -1),
    }));
  }
  return false;
}

/**
 * Whether undo and redo wait for a decision to save. Undo comes back through
 * live sync, where an edit can't be refused, and it could rewrite the words
 * an accepted suggestion is replacing.
 */
export function suggestionDecisionHoldsHistory(state: EditorState): boolean {
  return (suggestionHighlightKey.getState(state)?.specs ?? []).some(
    (spec) => spec.settling || spec.frozen,
  );
}

export function createSuggestionHighlightPlugin(): Plugin<SuggestionHighlightState> {
  return new Plugin<SuggestionHighlightState>({
    key: suggestionHighlightKey,
    state: {
      init: () => ({
        specs: [],
        activeId: null,
        decorations: DecorationSet.empty,
      }),
      apply(tr, value, _oldState, newState) {
        const meta = tr.getMeta(suggestionHighlightKey) as
          | SuggestionHighlightMeta
          | undefined;
        let specs = value.specs;
        let activeId = value.activeId;

        if (meta) {
          if (meta.specs !== undefined) specs = meta.specs;
          if (meta.activeId !== undefined) activeId = meta.activeId;
        } else if (tr.docChanged) {
          // Collaboration redraws the whole Page when the editor's plugins
          // change; an identical Page keeps every highlight where it was.
          if (tr.before.eq(tr.doc))
            return {
              ...value,
              decorations: DecorationSet.create(
                tr.doc,
                value.decorations.find(),
              ),
            };
          specs = specs
            .map((spec) => ({
              ...spec,
              from: tr.mapping.map(spec.from, 1),
              to: tr.mapping.map(spec.to, -1),
            }))
            .filter((spec) =>
              spec.kind === "insert" ||
              spec.kind === "add_block" ||
              (spec.kind === "delete" && !!spec.deletedText)
                ? true
                : spec.to > spec.from,
            );
        } else {
          return value;
        }

        return {
          specs,
          activeId,
          decorations: buildDecorations(newState.doc, specs, activeId),
        };
      },
    },
    filterTransaction: (transaction, state) =>
      !editsSettlingSuggestion(
        transaction,
        suggestionHighlightKey.getState(state)?.specs ?? [],
      ),
    props: {
      decorations(state) {
        return suggestionHighlightKey.getState(state)?.decorations ?? null;
      },
    },
  });
}

export const SuggestionHighlight = Extension.create({
  name: "suggestionHighlight",

  addProseMirrorPlugins() {
    return [createSuggestionHighlightPlugin()];
  },
});

export function setSuggestionHighlights(
  view: EditorView,
  meta: SuggestionHighlightMeta,
  selection?: Selection,
): void {
  const transaction = view.state.tr.setMeta(suggestionHighlightKey, meta);
  if (selection) transaction.setSelection(selection);
  view.dispatch(transaction);
}
