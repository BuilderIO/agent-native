import { useEffect, useId, useState } from "react";
import { IconCode, IconEdit, IconX } from "@tabler/icons-react";
import { defineBlock } from "../types.js";
import type { BlockReadProps, BlockEditProps } from "../types.js";
import { AiEditableFieldLabel } from "../AiEditableField.js";
import { htmlSchema, htmlMdx, type HtmlBlockData } from "./html.config.js";
import { useIsDark } from "./wireframe-kit.js";

/**
 * Standard library HTML / Tailwind block. The registry form of the plan
 * `custom-html` block: an author-supplied HTML (+ optional CSS) fragment
 * rendered inside a sandboxed iframe, with an inline source editor.
 *
 * Security: the fragment is rendered in a `sandbox="allow-same-origin"` iframe
 * with `referrerPolicy="no-referrer"` — no scripts execute — and the schema's
 * `noFullHtmlDocument` refine rejects document/script/handler markup before it
 * is ever stored. When the app injects `ctx.sanitizeHtml`, the fragment + CSS
 * are additionally sanitized before being placed in the iframe `srcDoc`.
 *
 * Styling uses app-agnostic shadcn utility classes (`border`, `bg-muted`,
 * `text-muted-foreground`) so the block renders cleanly in any template, not
 * just the plan app.
 */

/** Build the iframe document for a fragment, applying app sanitization if given. */
function buildSrcDoc(
  data: HtmlBlockData,
  theme: "light" | "dark",
  sanitize?: (html: string, css?: string) => string,
): string {
  const css = data.css ?? "";
  const body = sanitize ? sanitize(data.html, data.css) : data.html;
  // The iframe is isolated from the host's `.dark` class and CSS variables, so
  // bridge the current theme explicitly and expose the same semantic tokens that
  // generated wireframe/diagram HTML already uses.
  return `<!doctype html><html data-theme="${theme}"><head><style>:root{color-scheme:light;--wf-paper:#fbfaf6;--wf-card:#ffffff;--wf-ink:#1f1f1d;--wf-muted:#6f6a63;--wf-line:#ded8ce;--wf-radius:12px;--plan-document:var(--wf-paper);--plan-block:var(--wf-card);--plan-text:var(--wf-ink);--plan-muted:var(--wf-muted);--plan-line:var(--wf-line)}:root[data-theme="dark"]{color-scheme:dark;--wf-paper:#201f1c;--wf-card:#2a2825;--wf-ink:#ece8e1;--wf-muted:#9a948b;--wf-line:#43403a;--plan-document:var(--wf-paper);--plan-block:var(--wf-card);--plan-text:var(--wf-ink);--plan-muted:var(--wf-muted);--plan-line:var(--wf-line)}html,body{margin:0;min-height:100%;font-family:Inter,system-ui,sans-serif;color:var(--wf-ink);background:var(--wf-paper)}*{box-sizing:border-box}${css}</style></head><body>${body}</body></html>`;
}

function HtmlPreview({
  data,
  title,
  sanitize,
}: {
  data: HtmlBlockData;
  title?: string;
  sanitize?: (html: string, css?: string) => string;
}) {
  const isDark = useIsDark();
  const theme = isDark ? "dark" : "light";
  return (
    <>
      <iframe
        title={title || "Custom HTML block"}
        srcDoc={buildSrcDoc(data, theme, sanitize)}
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        className="mt-4 h-[360px] w-full rounded-xl border bg-muted"
      />
      {data.caption && (
        <p className="mt-3 text-sm text-muted-foreground">{data.caption}</p>
      )}
    </>
  );
}

/** Read-only renderer: the sandboxed iframe preview plus an optional caption. */
export function HtmlReadBlock({
  data,
  blockId,
  title,
  ctx,
}: BlockReadProps<HtmlBlockData>) {
  return (
    <section className="plan-block group" data-block-id={blockId}>
      {title && <div className="plan-block-label">{title}</div>}
      <HtmlPreview data={data} title={title} sanitize={ctx.sanitizeHtml} />
    </section>
  );
}

/**
 * Custom editor: an "Edit source" toggle that flips between the live preview and
 * inline HTML + CSS textareas (ported from the plan `CustomHtmlBlock`). The
 * title is rendered by the registry's edit-mode section wrapper, so this only
 * renders the toggle + content. Edits commit the merged data via `onChange`,
 * which the app routes through its generic `update-block` patch (re-validated by
 * the app schema).
 */
export function HtmlEditBlock({
  data,
  onChange,
  editable,
  blockId,
  title,
  summary,
  ctx,
}: BlockEditProps<HtmlBlockData>) {
  const htmlId = useId();
  const cssId = useId();
  const captionId = useId();
  const [editing, setEditing] = useState(false);
  const [html, setHtml] = useState(data.html);
  const [css, setCss] = useState(data.css ?? "");
  const [caption, setCaption] = useState(data.caption ?? "");

  useEffect(() => {
    setHtml(data.html);
    setCss(data.css ?? "");
    setCaption(data.caption ?? "");
  }, [data]);

  const fieldAction = (
    field: "HTML fragment" | "CSS" | "Caption",
    value: string,
  ) => ({
    blockId,
    blockType: "custom-html",
    blockTitle: title,
    blockSummary: summary,
    fieldValue: value,
    draftScope: `block:custom-html:${blockId}:${field.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    disabled: !editable,
    instructions:
      "Update the plan with update-visual-plan using a targeted update-block content patch for this custom-html block id. Preserve unrelated HTML/CSS/caption fields unless the requested edit requires changing them.",
    companionFields: [
      { label: "HTML fragment", value: html || "(empty)", language: "html" },
      { label: "CSS", value: css || "(empty)", language: "css" },
      { label: "Caption", value: caption || "(empty)", language: "text" },
    ],
  });

  return (
    <div className="plan-html-block group" data-an-block-edit>
      <div className="flex items-start justify-end gap-4">
        {editable && (
          <button
            type="button"
            data-plan-interactive
            aria-label={editing ? "Cancel editing source" : "Edit source"}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? (
              <IconX className="size-4" />
            ) : (
              <IconEdit className="size-4" />
            )}
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-2 grid gap-3" data-plan-interactive>
          <div className="group/field grid gap-1.5">
            <AiEditableFieldLabel
              htmlFor={htmlId}
              label="HTML fragment"
              ctx={ctx}
              action={fieldAction("HTML fragment", html)}
            />
            <textarea
              id={htmlId}
              value={html}
              disabled={!editable}
              onChange={(event) => setHtml(event.target.value)}
              className="flex min-h-48 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="HTML fragment"
            />
          </div>
          <div className="group/field grid gap-1.5">
            <AiEditableFieldLabel
              htmlFor={cssId}
              label="CSS"
              ctx={ctx}
              action={fieldAction("CSS", css)}
            />
            <textarea
              id={cssId}
              value={css}
              disabled={!editable}
              onChange={(event) => setCss(event.target.value)}
              className="flex min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Optional CSS"
            />
          </div>
          <div className="group/field grid gap-1.5">
            <AiEditableFieldLabel
              htmlFor={captionId}
              label="Caption"
              ctx={ctx}
              action={fieldAction("Caption", caption)}
            />
            <input
              id={captionId}
              type="text"
              value={caption}
              disabled={!editable}
              onChange={(event) => setCaption(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Optional caption"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              data-plan-interactive
              className="inline-flex h-9 items-center rounded-md px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              data-plan-interactive
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              onClick={() => {
                onChange({
                  ...data,
                  html,
                  css: css || undefined,
                  caption: caption || undefined,
                });
                setEditing(false);
              }}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <HtmlPreview data={data} title={title} sanitize={ctx.sanitizeHtml} />
      )}
    </div>
  );
}

/**
 * The standard HTML / Tailwind block spec. Both apps register this; the plan app
 * registers the matching React-free `{ schema, mdx }` server-side via
 * `html.config.ts`. `empty()` seeds a friendly starter fragment for slash
 * insertion.
 */
export const htmlBlock = defineBlock<HtmlBlockData>({
  type: "custom-html",
  schema: htmlSchema,
  mdx: htmlMdx,
  Read: HtmlReadBlock,
  Edit: HtmlEditBlock,
  placement: ["block"],
  // Config-driven: the render (a sandboxed card) differs from its source, so edit
  // the html/css/caption from a corner button + panel rather than always-inline.
  editSurface: "panel",
  label: "HTML / Tailwind",
  icon: IconCode,
  description:
    "An author-supplied HTML (with optional CSS) fragment rendered in a sandboxed iframe, with inline source editing.",
  empty: () => ({ html: '<div class="p-6">Edit this HTML fragment…</div>' }),
});
