import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type PlanMarkdownReaderProps = {
  markdown: string;
  className?: string;
};

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
          }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </div>
  );
}
