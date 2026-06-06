import { useState } from "react";
import { IconCode, IconEdit, IconX } from "@tabler/icons-react";
import { defineBlock } from "../types.js";
import type { BlockReadProps, BlockEditProps } from "../types.js";
import { htmlSchema, htmlMdx, type HtmlBlockData } from "./html.config.js";

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
  sanitize?: (html: string, css?: string) => string,
): string {
  const css = data.css ?? "";
  const body = sanitize ? sanitize(data.html, data.css) : data.html;
  return `<!doctype html><html><head><style>body{margin:0;min-height:100%;font-family:Inter,system-ui,sans-serif;color:#1f1f1d;background:transparent;}*{box-sizing:border-box}${css}</style></head><body>${body}</body></html>`;
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
  return (
    <>
      <iframe
        title={title || "Custom HTML block"}
        srcDoc={buildSrcDoc(data, sanitize)}
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
      {title && <h2>{title}</h2>}
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
  title,
  ctx,
}: BlockEditProps<HtmlBlockData>) {
  const [editing, setEditing] = useState(false);
  const [html, setHtml] = useState(data.html);
  const [css, setCss] = useState(data.css ?? "");

  return (
    <div className="plan-html-block group" data-an-block-edit>
      <div className="flex items-start justify-end gap-4">
        {editable && (
          <button
            type="button"
            data-plan-interactive
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? (
              <IconX className="size-4" />
            ) : (
              <IconEdit className="size-4" />
            )}
            {editing ? "Cancel" : "Edit source"}
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-2 grid gap-3" data-plan-interactive>
          <textarea
            value={html}
            onChange={(event) => setHtml(event.target.value)}
            className="flex min-h-48 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="HTML fragment"
          />
          <textarea
            value={css}
            onChange={(event) => setCss(event.target.value)}
            className="flex min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="Optional CSS"
          />
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
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              onClick={() => {
                onChange({ ...data, html, css: css || undefined });
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
  label: "HTML / Tailwind",
  icon: IconCode,
  description:
    "An author-supplied HTML (with optional CSS) fragment rendered in a sandboxed iframe, with inline source editing.",
  empty: () => ({ html: '<div class="p-6">Edit this HTML fragment…</div>' }),
});
