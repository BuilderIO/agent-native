import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeSurface } from "@agent-native/core/blocks";
import { cn } from "@/lib/utils";

type PlanMarkdownReaderProps = {
  markdown: string;
  className?: string;
};

/** Flatten react-markdown's code-element children into the raw code string. */
function extractText(node: ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    return extractText(
      (node.props as { children?: ReactNode }).children ?? null,
    );
  }
  return "";
}

/**
 * Read-only renderer for a plan `rich-text` block.
 *
 * This is the public / shared-reviewer / SSR read path. It MUST stay
 * Tiptap-free: the shared `RichMarkdownEditor` always instantiates a live
 * ProseMirror editor (even when `editable=false`), which is edit-view-only and
 * should never mount in an SSR/public context. Anonymous viewers and the
 * server render therefore go through react-markdown here instead.
 *
 * Markdown stays the single source of truth (GFM, same dialect the editor emits)
 * and the output reuses the existing `.plan-rich-markdown-editor`
 * `.an-rich-md-prose` styling so the read view matches the edit view exactly.
 * Fenced code blocks render through the shared {@link CodeSurface} so the read
 * view gets the same syntax-highlighted, light/dark, collapse-to-N-lines
 * treatment as the editor and code tabs (Shiki is client-only with a plain
 * `<pre>` SSR fallback, so this stays SSR-safe).
 */
export function PlanMarkdownReader({
  markdown,
  className,
}: PlanMarkdownReaderProps) {
  return (
    <div
      className={cn(
        "plan-rich-markdown-editor an-rich-md-wrapper an-rich-md-wrapper--readonly mt-4",
        className,
      )}
    >
      <div className="an-rich-md-prose">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ className: linkClassName, ...props }) => (
              <a
                {...props}
                className={cn("an-rich-md-link", linkClassName)}
                target="_blank"
                rel="noreferrer"
              />
            ),
            table: ({ className: tableClassName, ...props }) => (
              <table
                {...props}
                className={cn("an-rich-md-table", tableClassName)}
              />
            ),
            pre: ({ children }: ComponentPropsWithoutRef<"pre">) => {
              const codeEl = Array.isArray(children) ? children[0] : children;
              const codeProps = isValidElement(codeEl)
                ? (codeEl.props as { className?: string; children?: ReactNode })
                : null;
              const match = /language-([\w-]+)/.exec(
                codeProps?.className ?? "",
              );
              const code = extractText(codeProps?.children ?? null).replace(
                /\n$/,
                "",
              );
              return (
                <CodeSurface
                  code={code}
                  language={match?.[1]}
                  className="plan-code-surface--read"
                />
              );
            },
          }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </div>
  );
}
