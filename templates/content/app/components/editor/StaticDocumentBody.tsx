import { useT } from "@agent-native/core/client/i18n";
import { safeParseIconValue } from "@agent-native/core/icons";
import { renderMathToHtml } from "@shared/math-rendering";
import { nfmToDoc } from "@shared/nfm";
import {
  DOMSerializer,
  type DOMOutputSpec,
  type Node as ProseMirrorNode,
  type Schema,
} from "@tiptap/pm/model";
import { useLayoutEffect, useRef, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  CONTENT_BODY_DOM_MARK,
  CONTENT_BODY_ELEMENT_TIMING,
  markStartupMilestone,
} from "@/lib/startup-timing";

import {
  EMPTY_TOGGLE_BODY_PLACEHOLDER,
  humanizeTag,
  normalizeIndentAttr,
  parseAttrsJson,
  safeExternalPageUrl,
} from "./extensions/NotionExtensions";
import {
  noteStoredBodyImageFailed,
  storedBodyOnScreen,
} from "./stored-body-images";
import { ContentTableView } from "./table-view";

type Attrs = Record<string, string | null | undefined>;
type Child = Node | string | null;

/** Words the static body draws, in the reader's language. */
export interface StaticBodyLabels {
  imageBroken: string;
}

type StaticNodeView = (
  node: ProseMirrorNode,
  document: Document,
  labels: StaticBodyLabels,
) => { dom: HTMLElement; contentDOM?: HTMLElement };

function h(
  document: Document,
  tag: string,
  attrs: Attrs,
  ...children: Child[]
): HTMLElement {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value != null) element.setAttribute(name, value);
  }
  for (const child of children) if (child !== null) element.append(child);
  return element;
}

function icon(
  document: Document,
  size: number,
  path?: string,
  className?: string,
) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  if (className) svg.setAttribute("class", className);
  for (const [name, value] of Object.entries({
    width: String(size),
    height: String(size),
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  })) {
    svg.setAttribute(name, value);
  }
  if (path) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("d", path);
    svg.append(line);
  }
  return svg;
}

// TipTap mounts each React node view inside this element, and the stylesheet
// reaches some views through it (`.node-image .media-block`).
function reactNodeView(
  document: Document,
  node: ProseMirrorNode,
  view: HTMLElement,
) {
  return h(
    document,
    node.isInline ? "span" : "div",
    { class: `react-renderer node-${node.type.name}` },
    view,
  );
}

function nodeViewWrapper(
  document: Document,
  tag: string,
  attrs: Attrs,
  ...children: Child[]
) {
  return h(
    document,
    tag,
    { ...attrs, "data-node-view-wrapper": "", style: "white-space: normal;" },
    ...children,
  );
}

// A view's content hole holds one more element around the children, so a rule
// like `> :first-child` reaches that element rather than the first block.
function nodeViewContent(document: Document, attrs: Attrs) {
  const contentDOM = h(document, "div", {
    "data-node-view-content-react": "",
    "data-node-view-wrapper": "",
    style: "white-space: inherit;",
  });
  const dom = h(
    document,
    "div",
    { ...attrs, "data-node-view-content": "", style: "white-space: pre-wrap;" },
    contentDOM,
  );
  return { dom, contentDOM };
}

function mediaWidth(value: unknown): number | null {
  const width =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(width) || width <= 0) return null;
  return Math.round(width);
}

function mediaView(
  className: string,
  media: (
    node: ProseMirrorNode,
    document: Document,
    labels: StaticBodyLabels,
  ) => HTMLElement,
): StaticNodeView {
  return (node, document, labels) => {
    const width = mediaWidth(node.attrs.width);
    const block = node.attrs.src
      ? h(
          document,
          "div",
          {
            class: className,
            "data-resized": width ? "true" : null,
            style: width ? `width: ${width}px;` : null,
          },
          media(node, document, labels),
        )
      : h(
          document,
          "div",
          { class: "media-empty-block" },
          h(document, "div", { class: "media-empty-block__trigger" }, " "),
        );
    return {
      dom: reactNodeView(
        document,
        node,
        nodeViewWrapper(
          document,
          "div",
          { class: "media-block-wrapper", "data-drag-handle": "" },
          block,
        ),
      ),
    };
  };
}

// Tabler's `IconPhoto`, which ImageBlock draws in a failed image's box.
const PHOTO_ICON_PATH =
  "M15 8h.01M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3";

function brokenImage(document: Document, alt: string, label: string) {
  return h(
    document,
    "div",
    { class: "media-block__broken", role: "img", "aria-label": alt || label },
    icon(document, 24, PHOTO_ICON_PATH, "media-block__broken-icon"),
    h(
      document,
      "div",
      { class: "media-block__broken-copy" },
      h(document, "span", { class: "media-block__broken-title" }, label),
      alt.trim()
        ? h(document, "span", { class: "media-block__broken-alt" }, alt)
        : null,
    ),
  );
}

function staticMath(document: Document, latex: string, displayMode: boolean) {
  const variant = displayMode ? "block" : "inline";
  const rendered = renderMathToHtml(latex, displayMode);
  if (!rendered.ok) {
    return h(
      document,
      "code",
      { class: `content-math-error content-math-error--${variant}` },
      latex || " ",
    );
  }
  const math = h(document, "span", {
    class: `content-math content-math--${variant}`,
    contenteditable: "false",
  });
  math.innerHTML = rendered.html;
  return math;
}

/**
 * Node views draw these nodes as other markup than their `renderHTML`, and the
 * stylesheet lays out that markup, so the static body draws what each view
 * draws in an editable editor at rest: its boxes, not its controls or the data
 * it loads later. A view added to the editor needs one here, or an entry in
 * NODE_VIEWS_LAID_OUT_BY_RENDER_HTML.
 */
export const STATIC_NODE_VIEWS: Record<string, StaticNodeView> = {
  image: mediaView("media-block", (node, document, labels) => {
    const src: string = node.attrs.src;
    const alt: string = node.attrs.alt || "";
    const image = h(document, "img", {
      src,
      alt,
      class: "media-block__content",
      draggable: "false",
    });
    image.addEventListener(
      "error",
      () => {
        // A load can fail after its body has left the page and its failures
        // were forgotten; noting it then would start a later editor's working
        // image broken.
        if (!image.isConnected) return;
        noteStoredBodyImageFailed(src);
        image.replaceWith(brokenImage(document, alt, labels.imageBroken));
      },
      { once: true },
    );
    return image;
  }),
  // `preload="none"` keeps the stand-in from fetching media the editor's own
  // element fetches; both draw the same box until the metadata arrives.
  video: mediaView("media-block", (node, document) =>
    h(document, "video", {
      src: node.attrs.src,
      poster: node.attrs.poster || null,
      class: "media-block__content",
      controls: "",
      preload: "none",
      draggable: "false",
    }),
  ),
  audio: mediaView("media-block media-block--audio", (node, document) =>
    h(document, "audio", {
      src: node.attrs.src,
      class: "media-block__content",
      controls: "",
      preload: "none",
      draggable: "false",
    }),
  ),
  table: (node) => {
    // An editable editor builds the table's view without its attributes. 25 is
    // Table's default `cellMinWidth`, which CustomTable keeps.
    const view = new ContentTableView(node, 25);
    view.destroy();
    return {
      dom: view.dom as HTMLElement,
      contentDOM: view.contentDOM as HTMLElement,
    };
  },
  notionToggle: (node, document) => {
    const open = !!node.attrs.open;
    const empty = node.childCount === 0;
    const indent = normalizeIndentAttr(node.attrs.indent);
    const content = nodeViewContent(document, {
      class: "notion-toggle__content",
    });
    const toggle = nodeViewWrapper(
      document,
      "div",
      {
        class: [
          "notion-toggle",
          open && "notion-toggle--open",
          empty && "notion-toggle--body-empty",
        ]
          .filter(Boolean)
          .join(" "),
        "data-color": node.attrs.color || null,
        "data-heading-level": node.attrs.headingLevel || null,
        "data-nfm-indent": indent ? String(indent) : null,
        draggable: "true",
        "data-drag-handle": "",
      },
      h(
        document,
        "div",
        { class: "notion-toggle__summary-row" },
        h(
          document,
          "span",
          { class: "notion-toggle__chevron", contenteditable: "false" },
          icon(document, 18, open ? "M6 9l6 6l6 -6" : "M9 6l6 6l-6 6"),
        ),
        h(
          document,
          "span",
          { class: "notion-toggle__summary", contenteditable: "false" },
          node.attrs.summary || "",
        ),
      ),
      h(
        document,
        "div",
        {
          class: open
            ? "notion-toggle__body"
            : "notion-toggle__body notion-toggle__body--collapsed",
        },
        open && empty
          ? h(
              document,
              "div",
              {
                class:
                  "notion-toggle__body-placeholder notion-toggle__body-placeholder--empty-node",
                contenteditable: "false",
              },
              EMPTY_TOGGLE_BODY_PLACEHOLDER,
            )
          : null,
        content.dom,
      ),
    );
    return {
      dom: reactNodeView(document, node, toggle),
      contentDOM: content.contentDOM,
    };
  },
  notionCallout: (node, document) => {
    const value = typeof node.attrs.icon === "string" ? node.attrs.icon : "💡";
    const parsed = safeParseIconValue(value);
    const emoji =
      parsed.success && parsed.data?.kind === "emoji" ? parsed.data.emoji : "";
    const content = nodeViewContent(document, {
      "data-notion-callout-content": "true",
    });
    const callout = nodeViewWrapper(
      document,
      "div",
      {
        "data-notion-callout": "true",
        "data-icon": value,
        "data-color": node.attrs.color || null,
      },
      h(
        document,
        "div",
        { "data-notion-callout-icon": "true", contenteditable: "false" },
        h(
          document,
          "span",
          {
            class:
              "flex size-9 shrink-0 items-center justify-center rounded-md",
            style: "font-size: 22px;",
          },
          emoji,
        ),
      ),
      content.dom,
    );
    return {
      dom: reactNodeView(document, node, callout),
      contentDOM: content.contentDOM,
    };
  },
  notionBlockAtom: (node, document) => {
    const tagName = (node.attrs.tagName || "block") as string;
    const label = (node.attrs.label || "") as string;
    const attrs = parseAttrsJson(node.attrs.attrsJson as string);
    if (tagName === "equation") {
      const latex = label || attrs.latex || "";
      return {
        dom: reactNodeView(
          document,
          node,
          nodeViewWrapper(
            document,
            "div",
            { class: "content-equation", "data-latex": latex },
            staticMath(document, latex, true),
          ),
        ),
      };
    }
    const primary =
      label ||
      attrs.title ||
      attrs.alt ||
      attrs.url ||
      attrs.src ||
      humanizeTag(tagName);
    const externalUrl = safeExternalPageUrl(attrs.url || attrs.href || null);
    const view =
      tagName === "page"
        ? nodeViewWrapper(
            document,
            "div",
            {
              class: externalUrl
                ? "notion-page-reference notion-page-reference--clickable"
                : "notion-page-reference",
            },
            h(
              document,
              "button",
              {
                type: "button",
                class: "notion-page-reference__button",
                contenteditable: "false",
                disabled: "",
                tabindex: "-1",
              },
              h(
                document,
                "span",
                { class: "notion-page-reference__icon", "aria-hidden": "true" },
                icon(document, 20),
              ),
              h(
                document,
                "span",
                { class: "notion-page-reference__label" },
                primary,
              ),
              externalUrl
                ? icon(
                    document,
                    16,
                    undefined,
                    "notion-page-reference__external",
                  )
                : null,
            ),
          )
        : nodeViewWrapper(
            document,
            "div",
            { class: "notion-atom notion-atom--block" },
            h(
              document,
              "div",
              { class: "notion-atom__kind" },
              icon(document, 14),
              humanizeTag(tagName),
            ),
            h(document, "div", { class: "notion-atom__label" }, primary),
          );
    return { dom: reactNodeView(document, node, view) };
  },
  notionInlineAtom: (node, document) => {
    const tagName = (node.attrs.tagName || "mention") as string;
    const label = (node.attrs.label || "") as string;
    const latex =
      label || parseAttrsJson(node.attrs.attrsJson as string).latex || "";
    const view =
      tagName === "math"
        ? nodeViewWrapper(
            document,
            "span",
            {
              class: "content-inline-equation",
              contenteditable: "false",
              "data-latex": latex,
            },
            staticMath(document, latex, false),
          )
        : nodeViewWrapper(
            document,
            "span",
            { class: "notion-inline-atom", contenteditable: "false" },
            label || humanizeTag(tagName),
          );
    return { dom: reactNodeView(document, node, view) };
  },
  // Registry blocks load their data after the editor mounts and show this
  // placeholder until then.
  registryBlock: (node, document) => ({
    dom: reactNodeView(
      document,
      node,
      nodeViewWrapper(
        document,
        "div",
        { class: "plan-block-node", "data-block-id": node.attrs.blockId },
        h(
          document,
          "div",
          {
            class:
              "plan-block-node__placeholder rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground",
            contenteditable: "false",
          },
          " ",
        ),
      ),
    ),
  }),
  contentReference: (node, document) => ({
    dom: reactNodeView(
      document,
      node,
      nodeViewWrapper(
        document,
        "div",
        {
          class: "my-4",
          contenteditable: "false",
          "data-content-reference": node.attrs.sourcePath ?? "",
        },
        h(
          document,
          "section",
          {
            class:
              "content-reference-preview my-4 rounded-md border border-dashed bg-muted/20 text-sm",
          },
          h(
            document,
            "div",
            { class: "flex min-h-10 items-center gap-2 border-b px-3 py-2" },
            h(
              document,
              "div",
              { class: "size-4 shrink-0" },
              icon(document, 16),
            ),
            h(
              document,
              "div",
              { class: "min-w-0 flex-1" },
              h(
                document,
                "div",
                { class: "truncate font-medium text-foreground" },
                node.attrs.title?.trim() || " ",
              ),
              h(
                document,
                "div",
                { class: "truncate text-xs text-muted-foreground" },
                node.attrs.sourcePath || " ",
              ),
            ),
          ),
          h(
            document,
            "div",
            { class: "max-h-[520px] overflow-auto px-3 py-3" },
            h(document, "div", { class: "text-sm" }, " "),
          ),
        ),
      ),
    ),
  }),
  // The component itself is app code that only the editor's view renders; its
  // box appears empty until then.
  localMdxComponent: (node, document) => ({
    dom: reactNodeView(
      document,
      node,
      nodeViewWrapper(document, "div", {
        class: "group relative my-4",
        contenteditable: "false",
        "data-local-mdx-component": node.attrs.name || null,
      }),
    ),
  }),
};

/** Node views whose DOM lays out as their `renderHTML` does. */
export const NODE_VIEWS_LAID_OUT_BY_RENDER_HTML = new Set(["taskItem"]);

/**
 * Draws a stored body into `target` as the DOM the editor draws for it. Nodes
 * the editor draws with a node view take their STATIC_NODE_VIEWS markup, and
 * the rest their `renderHTML`. ProseMirror's view also ends some textblocks
 * with a break and marks leaves non-editable; both change line heights, so
 * they are added here too. Returns whether a textblock with text was tagged for
 * the body's Element Timing, as the editor's own BodyElementTiming does.
 */
export function renderStaticDocumentBody(
  schema: Schema,
  content: string,
  target: HTMLElement,
  labels: StaticBodyLabels,
): { timed: boolean } {
  const doc = schema.nodeFromJSON(nfmToDoc(content));
  const ownerDocument = target.ownerDocument;
  const base = DOMSerializer.fromSchema(schema);
  const nodes: Record<string, (node: ProseMirrorNode) => DOMOutputSpec> = {};
  const serializer = new DOMSerializer(nodes, base.marks);
  let timed = false;
  for (const [name, toDOM] of Object.entries(base.nodes)) {
    const view = STATIC_NODE_VIEWS[name];
    nodes[name] = (node) => {
      const { dom, contentDOM } = view
        ? view(node, ownerDocument, labels)
        : DOMSerializer.renderSpec(ownerDocument, toDOM(node));
      if (!contentDOM) {
        if (
          dom instanceof ownerDocument.defaultView!.Element &&
          dom.nodeName !== "BR" &&
          !dom.hasAttribute("contenteditable")
        ) {
          dom.setAttribute("contenteditable", "false");
        }
        return { dom };
      }
      if (!node.isTextblock) return { dom, contentDOM };
      // The break has to follow the content, so the textblock is filled here
      // rather than through its content hole.
      serializer.serializeFragment(
        node.content,
        { document: ownerDocument },
        contentDOM,
      );
      const last = node.lastChild;
      if (!last || !last.isText || last.text!.endsWith("\n")) {
        const trailingBreak = ownerDocument.createElement("br");
        trailingBreak.className = "ProseMirror-trailingBreak";
        contentDOM.appendChild(trailingBreak);
      }
      if (
        !timed &&
        node.textContent.trim() &&
        dom instanceof ownerDocument.defaultView!.Element
      ) {
        timed = true;
        dom.setAttribute("elementtiming", CONTENT_BODY_ELEMENT_TIMING);
      }
      return { dom };
    };
  }
  target.replaceChildren(
    serializer.serializeFragment(doc.content, { document: ownerDocument }),
  );
  return { timed };
}

// DocumentEditor's static body gives way to VisualEditor's in the commit that
// mounts the editor. The drawn nodes move across instead of being drawn again,
// so a long body costs nothing to hand over and its images stay loaded. The
// nodes carry the reader's words, so a body drawn in other words draws its own.
let handedOver: {
  content: string;
  labels: StaticBodyLabels;
  nodes: ChildNode[];
} | null = null;

/**
 * The stored body, drawn without an editor, for the moments before the page's
 * one editor can mount. It takes the place of `EditorContent` inside
 * `.visual-editor-wrapper` and is never `.ProseMirror`: that class means an
 * editor.
 */
export function StaticDocumentBody({
  schema,
  content,
  documentId,
}: {
  schema: Schema;
  content: string;
  /** Marks the body-visible startup milestone for this page when given. */
  documentId?: string;
}) {
  const t = useT();
  const imageBroken = t("editor.media.imageBroken");
  const bodyRef = useRef<HTMLDivElement>(null);
  const markedRef = useRef(false);
  const [failedContent, setFailedContent] = useState<string | null>(null);
  const failed = failedContent === content;
  useLayoutEffect(() => storedBodyOnScreen(), []);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const handOver = () => {
      const slot = {
        content,
        labels: { imageBroken },
        nodes: [...body.childNodes],
      };
      handedOver = slot;
      // Only a body mounting in this commit can take it.
      queueMicrotask(() => {
        if (handedOver === slot) handedOver = null;
      });
    };
    if (
      handedOver?.content === content &&
      handedOver.labels.imageBroken === imageBroken
    ) {
      body.replaceChildren(...handedOver.nodes);
      handedOver = null;
      return handOver;
    }
    let timed: boolean;
    try {
      ({ timed } = renderStaticDocumentBody(schema, content, body, {
        imageBroken,
      }));
    } catch (error) {
      // The editor draws this body from the live copy once it mounts; until
      // then the page shows it loading rather than empty.
      console.error("[content] could not draw the stored body", error);
      setFailedContent(content);
      return;
    }
    if (timed && documentId && !markedRef.current) {
      markedRef.current = true;
      markStartupMilestone(CONTENT_BODY_DOM_MARK, documentId);
    }
    return handOver;
  }, [schema, content, documentId, imageBroken]);

  if (failed) {
    return (
      <div className="flex flex-col gap-3 px-8 py-6">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }
  return (
    <div>
      <div
        ref={bodyRef}
        className="tiptap notion-editor"
        data-static-document-body=""
        translate="no"
      />
    </div>
  );
}
