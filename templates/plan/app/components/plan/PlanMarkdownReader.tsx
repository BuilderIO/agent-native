import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { isValidElement, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { IconLink } from "@tabler/icons-react";
import { CodeSurface } from "@agent-native/core/blocks";
import { cn } from "@/lib/utils";
import { PlanImageViewer } from "./PlanImageViewer";
import { detectPlanTextDirection } from "./planTextDirection";

type PlanMarkdownReaderProps = {
  markdown: string;
  className?: string;
  /**
   * When provided, h1/h2/h3 headings receive stable anchor ids matching the
   * TOC (`plan-heading-{blockId}-{index}`) and a copy-link affordance so users
   * can share deep links to individual sections.
   */
  blockId?: string;
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

export function buildPlanMarkdownSectionCopyUrl(
  href: string,
  sectionId: string,
): string {
  try {
    const url = new URL(href);
    url.searchParams.delete("bridge");
    url.hash = sectionId;
    return url.toString();
  } catch {
    const [base] = href.split("#", 1);
    return `${base || href}#${sectionId}`;
  }
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
  blockId,
}: PlanMarkdownReaderProps) {
  // Track the heading count so each heading gets the same index-based id that
  // `collectPlanTocItems` assigns: `plan-heading-{blockId}-{index}`.
  const headingIndexRef = useRef(0);
  // Reset the counter each render (new markdown / blockId) so ids are stable.
  headingIndexRef.current = 0;
  const textDirection = detectPlanTextDirection(markdown);

  const makeHeading = useCallback(
    (Tag: ElementType, { children }: { children?: ReactNode }) => {
      if (!blockId) {
        // No blockId — render plain heading without anchor.
        return <Tag>{children}</Tag>;
      }
      const index = headingIndexRef.current++;
      const id = `plan-heading-${blockId}-${index}`;
      return (
        <Tag id={id} className="group/heading relative">
          {children}
          <a
            href={`#${id}`}
            aria-label="Copy link to this section"
            className="plan-heading-anchor ml-2 inline-flex size-4 cursor-pointer items-center justify-center rounded opacity-0 transition-opacity group-hover/heading:opacity-60 hover:!opacity-100"
            onClick={(event) => {
              event.preventDefault();
              try {
                const copyUrl = buildPlanMarkdownSectionCopyUrl(
                  window.location.href,
                  id,
                );
                history.pushState(null, "", `#${id}`);
                void navigator.clipboard.writeText(copyUrl);
              } catch {
                // Clipboard or history not available — ignore.
              }
            }}
          >
            <IconLink className="size-3.5 text-plan-muted" />
          </a>
        </Tag>
      );
    },
    [blockId],
  );

  return (
    <div
      className={cn(
        "plan-rich-markdown-editor an-rich-md-wrapper an-rich-md-wrapper--readonly mt-4",
        className,
      )}
    >
      <div className="an-rich-md-prose" dir={textDirection}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => makeHeading("h1", { children }),
            h2: ({ children }) => makeHeading("h2", { children }),
            h3: ({ children }) => makeHeading("h3", { children }),
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
            code: ({
              className: codeClassName,
              children,
              node: _node,
              ...props
            }: ComponentPropsWithoutRef<"code"> & { node?: unknown }) => (
              <code
                {...props}
                className={codeClassName}
                dir={codeClassName ? undefined : "ltr"}
              >
                {children}
              </code>
            ),
            img: ({ src, alt }) => (
              <PlanImageViewer
                src={typeof src === "string" ? src : ""}
                alt={typeof alt === "string" ? alt : ""}
                loading="lazy"
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
