import {
  escapeHtml,
  indentMarkdown,
  serializeTagAttributes,
} from "@shared/notion-markdown";
import {
  IconChevronRight,
  IconChevronDown,
  IconDatabase,
  IconExternalLink,
  IconFileText,
} from "@tabler/icons-react";
import type { Fragment, Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  Mark,
  Node,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from "@tiptap/react";

const BLOCK_ATOM_TAGS = [
  "page",
  "database",
  "file",
  "pdf",
  "bookmark",
  "embed",
  "table_of_contents",
  "synced_block",
  "synced_block_reference",
  "unknown",
  "equation",
];

const INLINE_ATOM_TAGS = [
  "mention-user",
  "mention-page",
  "mention-database",
  "mention-date",
  "mention-link-preview",
  "mention-template-mention",
  "mention-custom-emoji",
];

export interface NotionPageLink {
  notionPageId: string;
  documentId: string;
  title: string;
  icon: string | null;
}

interface NotionBlockAtomOptions {
  resolvePageLink?: (notionPageId: string) => NotionPageLink | null;
  onOpenPageLink?: (documentId: string) => void;
}

function readElementAttributes(
  element: HTMLElement,
  omit: string[] = [],
): Record<string, string> {
  const ignored = new Set(omit);
  const attrs: Record<string, string> = {};

  for (const { name, value } of Array.from(element.attributes)) {
    if (ignored.has(name)) continue;
    attrs[name] = value;
  }

  return attrs;
}

function parseAttrsJson(
  attrsJson: string | null | undefined,
): Record<string, string> {
  if (!attrsJson) return {};

  try {
    const parsed = JSON.parse(attrsJson) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => {
        return typeof entry[0] === "string" && typeof entry[1] === "string";
      }),
    );
  } catch {
    return {};
  }
}

function serializeInnerMarkdown(editor: any, node: any): string {
  if (!editor?.storage?.markdown?.serializer) {
    return node.textContent || "";
  }
  return editor.storage.markdown.serializer.serialize(node).trimEnd();
}

function serializeContainerTag(
  tagName: string,
  attrs: Record<string, string | number | boolean | null | undefined>,
  innerMarkdown: string,
): string {
  const openTag = `<${tagName}${serializeTagAttributes(attrs)}>`;
  if (!innerMarkdown.trim()) {
    return `${openTag}\n</${tagName}>`;
  }
  return `${openTag}\n${indentMarkdown(innerMarkdown)}\n</${tagName}>`;
}

function serializeAtomTag(
  tagName: string,
  attrsJson: string,
  label: string,
): string {
  const attrs = parseAttrsJson(attrsJson);
  const openTag = `<${tagName}${serializeTagAttributes(attrs)}>`;
  return label.trim()
    ? `${openTag}${escapeHtml(label)}</${tagName}>`
    : `<${tagName}${serializeTagAttributes(attrs)} />`;
}

function humanizeTag(tagName: string): string {
  return tagName.replace(/[_-]/g, " ");
}

function normalizeNotionPageId(input: string | null | undefined) {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  if (/^[0-9a-fA-F]{32}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-fA-F-]{36}$/.test(trimmed)) {
    return trimmed.replace(/-/g, "").toLowerCase();
  }
  try {
    const url = new URL(trimmed);
    const slug = url.pathname.split("/").filter(Boolean).pop() || "";
    const match =
      slug.match(/([0-9a-fA-F]{32})$/) || slug.match(/([0-9a-fA-F-]{36})$/);
    return match?.[1]?.replace(/-/g, "").toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function getNotionPageId(attrs: Record<string, string>) {
  return (
    normalizeNotionPageId(attrs.url) ??
    normalizeNotionPageId(attrs.href) ??
    normalizeNotionPageId(attrs.id) ??
    normalizeNotionPageId(attrs.pageId) ??
    normalizeNotionPageId(attrs.page_id)
  );
}

function safeExternalPageUrl(input: string | null): string | null {
  if (!input) return null;
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export const TOGGLE_SUMMARY_PLACEHOLDER = "Toggle";
export const EMPTY_TOGGLE_BODY_PLACEHOLDER =
  "Empty toggle. Click or drop blocks inside.";

function normalizeIndentAttr(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : 0;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 8) : 0;
}

export function focusMostRecentEmptyToggleSummary(editor: {
  view: { dom: HTMLElement };
}) {
  const schedule =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (callback: FrameRequestCallback) => setTimeout(callback, 0);

  schedule(() => {
    let editorDom: HTMLElement;
    try {
      editorDom = editor.view.dom;
    } catch {
      return;
    }

    const inputs = Array.from(
      editorDom.querySelectorAll<HTMLInputElement>(".notion-toggle__summary"),
    );
    const target =
      [...inputs].reverse().find((input) => input.value === "") ??
      inputs[inputs.length - 1];

    target?.focus();
    target?.select();
  });
}

function ToggleView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const open = !!node.attrs.open;
  const setOpen = (value: boolean) => updateAttributes({ open: value });
  const summary = (node.attrs.summary || "") as string;
  const isEditable = editor.isEditable;
  const firstChild = node.firstChild;
  const bodyHasNoBlocks = node.childCount === 0;
  const bodyIsEmpty =
    bodyHasNoBlocks ||
    (node.childCount === 1 &&
      firstChild?.type.name === "paragraph" &&
      firstChild.content.size === 0 &&
      !firstChild.textContent.trim());

  const focusEmptyBody = (event: React.MouseEvent<HTMLElement>) => {
    if (!isEditable) return;
    event.preventDefault();
    event.stopPropagation();

    const pos = getPos();
    if (typeof pos !== "number") return;

    if (!open) setOpen(true);

    editor
      .chain()
      .focus()
      .insertContentAt(pos + 1, { type: "paragraph" })
      .focus(pos + 2)
      .run();
  };

  const getEmptyBodyInsertPos = () => {
    if (!isEditable) return;

    const pos = getPos();
    if (typeof pos !== "number") return;

    const currentNode = editor.state.doc.nodeAt(pos);
    if (
      !currentNode ||
      currentNode.type.name !== "notionToggle" ||
      currentNode.childCount > 0
    ) {
      return;
    }

    return pos + 1;
  };

  const allowEmptyBodyDrop = (event: React.DragEvent<HTMLElement>) => {
    if (!getEmptyBodyInsertPos()) return;

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  };

  const handleEmptyBodyDrop = (event: React.DragEvent<HTMLElement>) => {
    const insertPos = getEmptyBodyInsertPos();
    if (!insertPos) return;

    const dragging = (
      editor.view as typeof editor.view & {
        dragging?: { slice?: { content: Fragment }; move?: boolean } | null;
      }
    ).dragging;
    const text = event.dataTransfer?.getData("text/plain").trim();
    let contentToInsert: Fragment | ProseMirrorNode | null = null;

    if (dragging?.slice?.content?.size) {
      contentToInsert = dragging.slice.content;
    } else if (text) {
      const textNode = editor.state.schema.text(text);
      contentToInsert =
        editor.state.schema.nodes.paragraph?.create(null, textNode) ?? null;
    }

    if (!contentToInsert) return;

    event.preventDefault();
    event.stopPropagation();

    const { selection } = editor.state;
    let targetPos = insertPos;
    let tr = editor.state.tr;

    if (
      dragging?.move &&
      !selection.empty &&
      selection.from <= targetPos &&
      selection.to >= targetPos
    ) {
      return;
    }

    if (dragging?.move && !selection.empty && selection.from < targetPos) {
      tr = tr.delete(selection.from, selection.to);
      targetPos -= selection.to - selection.from;
    }

    tr = tr.insert(targetPos, contentToInsert);

    if (dragging?.move && !selection.empty && selection.from > insertPos) {
      tr = tr.delete(
        tr.mapping.map(selection.from, 1),
        tr.mapping.map(selection.to, -1),
      );
    }

    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();
    (
      editor.view as typeof editor.view & {
        dragging?: unknown;
      }
    ).dragging = null;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isEditable) return;

    if (e.key === "Enter") {
      e.preventDefault();
      const pos = getPos();
      if (typeof pos !== "number") return;
      // Insert a new toggle after this one
      const endPos = pos + node.nodeSize;
      editor
        .chain()
        .focus()
        .insertContentAt(endPos, {
          type: "notionToggle",
          attrs: { summary: "", open: true },
          content: [{ type: "paragraph" }],
        })
        .run();
      // Focus the new toggle's summary input after render
      setTimeout(() => {
        const wrapper = editor.view.dom.closest(".visual-editor-wrapper");
        if (!wrapper) return;
        const toggles = wrapper.querySelectorAll(".notion-toggle__summary");
        const allToggles = Array.from(toggles) as HTMLInputElement[];
        const currentInput = e.currentTarget;
        const idx = allToggles.indexOf(currentInput);
        if (idx >= 0 && allToggles[idx + 1]) {
          allToggles[idx + 1].focus();
        }
      }, 0);
    } else if (e.key === "Backspace" && summary === "") {
      e.preventDefault();
      const pos = getPos();
      if (typeof pos !== "number") return;
      // Delete this empty toggle and replace with paragraph
      editor
        .chain()
        .focus()
        .deleteRange({ from: pos, to: pos + node.nodeSize })
        .insertContentAt(pos, { type: "paragraph" })
        .focus(pos + 1)
        .run();
    }
  };

  return (
    <NodeViewWrapper
      className={`notion-toggle ${open ? "notion-toggle--open" : ""} ${
        bodyIsEmpty ? "notion-toggle--body-empty" : ""
      }`}
      data-color={node.attrs.color || undefined}
      data-heading-level={node.attrs.headingLevel || undefined}
      data-nfm-indent={normalizeIndentAttr(node.attrs.indent) || undefined}
      draggable="true"
      data-drag-handle=""
    >
      <div
        className="notion-toggle__summary-row"
        onClick={() => setOpen(!open)}
      >
        <span className="notion-toggle__chevron" contentEditable={false}>
          {open ? (
            <IconChevronDown size={18} stroke={2} />
          ) : (
            <IconChevronRight size={18} stroke={2} />
          )}
        </span>
        {isEditable ? (
          <input
            value={summary}
            onChange={(event) =>
              updateAttributes({ summary: event.currentTarget.value })
            }
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            placeholder={TOGGLE_SUMMARY_PLACEHOLDER}
            className="notion-toggle__summary"
          />
        ) : (
          <span className="notion-toggle__summary" contentEditable={false}>
            {summary || TOGGLE_SUMMARY_PLACEHOLDER}
          </span>
        )}
      </div>
      <div
        className={`notion-toggle__body ${open ? "" : "notion-toggle__body--collapsed"}`}
      >
        {isEditable && open && bodyHasNoBlocks ? (
          <div
            className="notion-toggle__body-placeholder notion-toggle__body-placeholder--empty-node"
            contentEditable={false}
            onDragEnter={allowEmptyBodyDrop}
            onDragOver={allowEmptyBodyDrop}
            onDrop={handleEmptyBodyDrop}
            onMouseDown={focusEmptyBody}
          >
            {EMPTY_TOGGLE_BODY_PLACEHOLDER}
          </div>
        ) : null}
        <NodeViewContent className="notion-toggle__content" />
      </div>
    </NodeViewWrapper>
  );
}

function BlockAtomView({ node, extension }: NodeViewProps) {
  const tagName = (node.attrs.tagName || "block") as string;
  const label = (node.attrs.label || "") as string;
  const attrs = parseAttrsJson(node.attrs.attrsJson as string);
  const options = extension.options as NotionBlockAtomOptions;
  const notionPageId = tagName === "page" ? getNotionPageId(attrs) : null;
  const pageLink = notionPageId
    ? options.resolvePageLink?.(notionPageId)
    : null;
  const primary =
    pageLink?.title ||
    label ||
    attrs.title ||
    attrs.alt ||
    attrs.url ||
    attrs.src ||
    humanizeTag(tagName);
  const canOpenLocalPage = Boolean(pageLink && options.onOpenPageLink);
  const externalUrl = safeExternalPageUrl(attrs.url || attrs.href || null);

  if (tagName === "page") {
    const openPage = () => {
      if (pageLink && options.onOpenPageLink) {
        options.onOpenPageLink(pageLink.documentId);
        return;
      }
      if (externalUrl) {
        window.open(externalUrl, "_blank", "noopener,noreferrer");
      }
    };

    return (
      <NodeViewWrapper
        className={`notion-page-reference ${
          canOpenLocalPage || externalUrl
            ? "notion-page-reference--clickable"
            : ""
        }`}
      >
        <button
          type="button"
          className="notion-page-reference__button"
          contentEditable={false}
          disabled={!canOpenLocalPage && !externalUrl}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            openPage();
          }}
        >
          <span className="notion-page-reference__icon" aria-hidden="true">
            {pageLink?.icon || <IconFileText size={20} stroke={1.8} />}
          </span>
          <span className="notion-page-reference__label">{primary}</span>
          {!pageLink && externalUrl ? (
            <IconExternalLink
              className="notion-page-reference__external"
              size={16}
              stroke={1.8}
            />
          ) : null}
        </button>
      </NodeViewWrapper>
    );
  }

  const AtomIcon = tagName === "database" ? IconDatabase : IconFileText;

  return (
    <NodeViewWrapper className="notion-atom notion-atom--block">
      <div className="notion-atom__kind">
        <AtomIcon size={14} stroke={1.8} />
        {humanizeTag(tagName)}
      </div>
      <div className="notion-atom__label">{primary}</div>
    </NodeViewWrapper>
  );
}

export const NotionSpanMark = Mark.create({
  name: "notionSpan",

  priority: 1000,

  addAttributes() {
    return {
      color: { default: null },
      bgColor: { default: null },
      underline: { default: null },
      href: { default: null },
      attrsJson: { default: "{}" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[color], span[bg_color], span[underline], span[data-notion-span]",
        getAttrs: (element) => {
          const node = element as HTMLElement;
          return {
            color: node.getAttribute("color"),
            bgColor: node.getAttribute("bg_color"),
            underline: node.getAttribute("underline"),
            href: node.getAttribute("href"),
            attrsJson: JSON.stringify(
              readElementAttributes(node, [
                "data-notion-span",
                "style",
                "class",
              ]),
            ),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = parseAttrsJson(HTMLAttributes.attrsJson as string);
    const style: string[] = [];

    if (HTMLAttributes.color) {
      style.push(`color: ${HTMLAttributes.color}`);
    }
    if (HTMLAttributes.bgColor) {
      style.push(`background-color: ${HTMLAttributes.bgColor}`);
    }
    if (HTMLAttributes.underline === "true") {
      style.push("text-decoration: underline");
    }

    return [
      "span",
      mergeAttributes(attrs, {
        "data-notion-span": "true",
        color: HTMLAttributes.color || undefined,
        bg_color: HTMLAttributes.bgColor || undefined,
        underline: HTMLAttributes.underline || undefined,
        href: HTMLAttributes.href || undefined,
        style: style.length ? style.join("; ") : undefined,
      }),
      0,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_state: any, mark: any) => {
            const attrs = parseAttrsJson(mark.attrs.attrsJson);
            return `<span${serializeTagAttributes(attrs)}>`;
          },
          close: "</span>",
          expelEnclosingWhitespace: true,
        },
        parse: {},
      },
    };
  },
});

export const NotionToggle = Node.create({
  name: "notionToggle",
  group: "block",
  content: "block*",
  defining: true,
  draggable: true,

  addAttributes() {
    return {
      summary: { default: "" },
      color: { default: null },
      headingLevel: { default: null },
      open: { default: false },
      indent: { default: 0 },
    };
  },

  parseHTML() {
    return [
      {
        tag: "details",
        getAttrs: (element) => {
          const node = element as HTMLElement;
          return {
            summary: node.querySelector("summary")?.textContent?.trim() || "",
            color: node.getAttribute("color"),
            headingLevel: node.getAttribute("data-heading-level"),
            open: node.hasAttribute("open"),
            indent: normalizeIndentAttr(node.getAttribute("data-nfm-indent")),
          };
        },
        contentElement: (element) => {
          const body = element.ownerDocument.createElement("div");
          for (const child of Array.from(element.childNodes)) {
            if (
              child.nodeType === globalThis.Node.ELEMENT_NODE &&
              (child as HTMLElement).tagName.toLowerCase() === "summary"
            ) {
              continue;
            }
            body.appendChild(child.cloneNode(true));
          }
          return body;
        },
      },
      {
        tag: "div[data-notion-toggle]",
        getAttrs: (element) => {
          const node = element as HTMLElement;
          return {
            summary: node.getAttribute("data-summary") || "",
            color: node.getAttribute("data-color"),
            headingLevel: node.getAttribute("data-heading-level"),
            open: node.getAttribute("data-open") === "true",
            indent: normalizeIndentAttr(node.getAttribute("data-nfm-indent")),
          };
        },
        contentElement: (element) =>
          (element as HTMLElement).querySelector(
            "[data-notion-toggle-content]",
          ) as HTMLElement,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-notion-toggle": "true",
        "data-summary": HTMLAttributes.summary || "",
        "data-color": HTMLAttributes.color || undefined,
        "data-heading-level": HTMLAttributes.headingLevel || undefined,
        "data-open": HTMLAttributes.open ? "true" : undefined,
        "data-nfm-indent": HTMLAttributes.indent
          ? String(HTMLAttributes.indent)
          : undefined,
      }),
      [
        "div",
        { "data-notion-toggle-summary": "true" },
        HTMLAttributes.summary || "",
      ],
      ["div", { "data-notion-toggle-content": "true" }, 0],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleView);
  },
  addStorage() {
    return {
      markdown: {
        // NOTE: must be a regular function (not arrow) so that
        // tiptap-markdown's `serialize.bind({editor, options})` actually
        // sets `this`. Arrow functions ignore .bind() — that left
        // `this.editor` undefined inside `serializeInnerMarkdown`,
        // which silently fell back to `node.textContent` and stripped
        // every paragraph break, blockquote marker, and inline mark
        // from the toggle's contents on save.
        serialize: function (_state: any, node: any) {
          const attrs: Record<string, string> = {};
          if (node.attrs.color) attrs.color = String(node.attrs.color);
          if (node.attrs.headingLevel) {
            attrs["data-heading-level"] = String(node.attrs.headingLevel);
          }
          if (node.attrs.open) attrs.open = "";
          const indent = normalizeIndentAttr(node.attrs.indent);
          const prefix = "\t".repeat(indent);
          const inner = serializeInnerMarkdown((this as any).editor, node);
          const openTag = `<details${serializeTagAttributes(attrs)}>`;
          _state.write(`${prefix}${openTag}`);
          _state.ensureNewLine();
          _state.write(
            `${prefix}<summary>${escapeHtml(node.attrs.summary || "")}</summary>`,
          );
          if (inner.trim()) {
            _state.ensureNewLine();
            _state.write(indentMarkdown(inner, `${prefix}\t`));
          }
          _state.ensureNewLine();
          _state.write(`${prefix}</details>`);
          _state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

export const NotionCallout = Node.create({
  name: "notionCallout",
  group: "block",
  content: "block*",
  defining: true,
  draggable: true,

  addAttributes() {
    return {
      icon: { default: "💡" },
      color: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "callout",
        getAttrs: (element) => {
          const node = element as HTMLElement;
          return {
            icon: node.getAttribute("icon") || "💡",
            color: node.getAttribute("color"),
          };
        },
      },
      {
        tag: "div[data-notion-callout]",
        getAttrs: (element) => {
          const node = element as HTMLElement;
          return {
            icon: node.getAttribute("data-icon") || "💡",
            color: node.getAttribute("data-color"),
          };
        },
        contentElement: (element) =>
          (element as HTMLElement).querySelector(
            "[data-notion-callout-content]",
          ) as HTMLElement,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-notion-callout": "true",
        "data-icon": HTMLAttributes.icon || "💡",
        "data-color": HTMLAttributes.color || undefined,
      }),
      [
        "div",
        { "data-notion-callout-icon": "true" },
        HTMLAttributes.icon || "💡",
      ],
      ["div", { "data-notion-callout-content": "true" }, 0],
    ];
  },

  addStorage() {
    return {
      markdown: {
        // Regular function — see NotionToggle.serialize for why.
        serialize: function (_state: any, node: any) {
          const inner = serializeInnerMarkdown((this as any).editor, node);
          _state.write(
            serializeContainerTag(
              "callout",
              {
                icon: node.attrs.icon || "💡",
                color: node.attrs.color || null,
              },
              inner,
            ),
          );
          _state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

export const NotionColumns = Node.create({
  name: "notionColumns",
  group: "block",
  content: "notionColumn+",
  defining: true,

  parseHTML() {
    return [{ tag: "columns" }, { tag: "div[data-notion-columns]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-notion-columns": "true" }),
      0,
    ];
  },

  addStorage() {
    return {
      markdown: {
        // Regular function — see NotionToggle.serialize for why.
        serialize: function (_state: any, node: any) {
          const inner = serializeInnerMarkdown((this as any).editor, node);
          _state.write(serializeContainerTag("columns", {}, inner));
          _state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

export const NotionColumn = Node.create({
  name: "notionColumn",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: "column" }, { tag: "div[data-notion-column]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-notion-column": "true" }),
      0,
    ];
  },

  addStorage() {
    return {
      markdown: {
        // Regular function — see NotionToggle.serialize for why.
        serialize: function (_state: any, node: any) {
          const inner = serializeInnerMarkdown((this as any).editor, node);
          _state.write(serializeContainerTag("column", {}, inner));
          _state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

export const NotionBlockAtom = Node.create({
  name: "notionBlockAtom",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions(): NotionBlockAtomOptions {
    return {
      resolvePageLink: undefined,
      onOpenPageLink: undefined,
    };
  },

  addAttributes() {
    return {
      tagName: { default: "unknown" },
      attrsJson: { default: "{}" },
      label: { default: "" },
    };
  },

  parseHTML() {
    return [
      ...BLOCK_ATOM_TAGS.map((tag) => ({
        tag,
        getAttrs: (element: any) => {
          const node = element as HTMLElement;
          return {
            tagName: tag,
            attrsJson: JSON.stringify(readElementAttributes(node)),
            label: node.textContent?.trim() || "",
          };
        },
      })),
      {
        tag: "div[data-notion-block-atom]",
        getAttrs: (element) => {
          const node = element as HTMLElement;
          return {
            tagName: node.getAttribute("data-tag-name") || "unknown",
            attrsJson: node.getAttribute("data-attrs-json") || "{}",
            label: node.getAttribute("data-label") || "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-notion-block-atom": "true",
        "data-tag-name": HTMLAttributes.tagName,
        "data-attrs-json": HTMLAttributes.attrsJson,
        "data-label": HTMLAttributes.label || "",
      }),
      HTMLAttributes.label || humanizeTag(HTMLAttributes.tagName || "block"),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockAtomView);
  },

  addStorage() {
    return {
      markdown: {
        serialize: (_state: any, node: any) => {
          _state.write(
            serializeAtomTag(
              node.attrs.tagName || "unknown",
              node.attrs.attrsJson || "{}",
              node.attrs.label || "",
            ),
          );
          _state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

export const NotionInlineAtom = Node.create({
  name: "notionInlineAtom",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      tagName: { default: "mention-user" },
      attrsJson: { default: "{}" },
      label: { default: "" },
    };
  },

  parseHTML() {
    return [
      ...INLINE_ATOM_TAGS.map((tag) => ({
        tag,
        getAttrs: (element: any) => {
          const node = element as HTMLElement;
          return {
            tagName: tag,
            attrsJson: JSON.stringify(readElementAttributes(node)),
            label: node.textContent?.trim() || "",
          };
        },
      })),
      {
        tag: "span[data-notion-inline-atom]",
        getAttrs: (element) => {
          const node = element as HTMLElement;
          return {
            tagName: node.getAttribute("data-tag-name") || "mention-user",
            attrsJson: node.getAttribute("data-attrs-json") || "{}",
            label: node.textContent?.trim() || "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-notion-inline-atom": "true",
        "data-tag-name": HTMLAttributes.tagName,
        "data-attrs-json": HTMLAttributes.attrsJson,
        class: "notion-inline-atom",
      }),
      HTMLAttributes.label || humanizeTag(HTMLAttributes.tagName || "mention"),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize: (_state: any, node: any) => {
          _state.write(
            serializeAtomTag(
              node.attrs.tagName || "mention-user",
              node.attrs.attrsJson || "{}",
              node.attrs.label || "",
            ),
          );
        },
        parse: {},
      },
    };
  },
});

export function createNotionEditorExtensions(
  blockAtomOptions: NotionBlockAtomOptions = {},
) {
  return [
    NotionSpanMark,
    NotionToggle,
    NotionCallout,
    NotionColumns,
    NotionColumn,
    NotionBlockAtom.configure(blockAtomOptions),
    NotionInlineAtom,
  ];
}
