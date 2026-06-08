import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type UIEvent,
} from "react";
import { IconCheck, IconCode, IconCopy } from "@tabler/icons-react";
import { cn } from "../../utils.js";
import { defineBlock } from "../types.js";
import type { BlockReadProps, BlockEditProps } from "../types.js";
import { CodeSurface } from "./HighlightedCode.js";
import {
  highlightCode,
  inferLanguageFromFilename,
  normalizeCodeLanguage,
} from "./code-highlight.js";
import { codeSchema, codeMdx, type CodeData } from "./code.config.js";

/**
 * Standard `code` block (STANDARD core library): THE primitive single code
 * snippet, used everywhere in plan + content. Notion-style — one border, a
 * hover-revealed language switcher + copy, and the shared collapse-to-N-lines
 * read surface. A "file rail" of several files is just the `tabs` primitive
 * holding `code` blocks; there is no bespoke "code-tabs" container.
 *
 * Read = the shared {@link CodeSurface} (Shiki, single border, language label,
 * "Show N more lines"). Edit = a clean, single-border editable surface (no
 * drag-to-resize; it auto-grows to its content) with the same hover chrome.
 */

/** Language options for the hover switcher; "" is the Auto-detect sentinel. */
const CODE_LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Auto" },
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "tsx", label: "TSX" },
  { value: "jsx", label: "JSX" },
  { value: "json", label: "JSON" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "bash", label: "Bash" },
  { value: "python", label: "Python" },
  { value: "sql", label: "SQL" },
  { value: "yaml", label: "YAML" },
  { value: "markdown", label: "Markdown" },
  { value: "graphql", label: "GraphQL" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "diff", label: "Diff" },
];

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      data-plan-interactive
      aria-label={copied ? "Copied" : "Copy code"}
      title={copied ? "Copied" : "Copy code"}
      className="plan-code-chip"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          },
          () => {},
        );
      }}
    >
      {copied ? (
        <IconCheck className="size-3.5" />
      ) : (
        <IconCopy className="size-3.5" />
      )}
    </button>
  );
}

/* ── Read ──────────────────────────────────────────────────────────────────── */

function CodeRead({ data, blockId }: BlockReadProps<CodeData>) {
  const language =
    normalizeCodeLanguage(data.language) ??
    inferLanguageFromFilename(data.filename) ??
    undefined;
  return (
    <section className="plan-block" data-block-id={blockId}>
      <div className="plan-code group relative">
        {data.filename && (
          <div className="plan-code-head">
            <span className="plan-code-filename">
              <IconCode className="size-4 shrink-0 opacity-70" />
              {data.filename}
            </span>
            <span className="plan-code-chrome">
              <CopyButton value={data.code} />
            </span>
          </div>
        )}
        <CodeSurface
          code={data.code}
          language={language}
          maxLines={data.maxLines}
          className={data.filename ? "mt-0" : "mt-0"}
        />
        {!data.filename && (
          <span className="plan-code-chrome plan-code-chrome-float">
            <CopyButton value={data.code} />
          </span>
        )}
        {data.caption && <p className="plan-code-caption">{data.caption}</p>}
      </div>
    </section>
  );
}

/* ── Edit (single border, no resize, auto-grow, hover chrome) ──────────────── */

function CodeEditorSurface({
  code,
  language,
  filename,
  editable,
  onCodeChange,
  onLanguageChange,
}: {
  code: string;
  language?: string;
  filename?: string;
  editable: boolean;
  onCodeChange: (code: string) => void;
  onLanguageChange: (language: string | undefined) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightLayerRef = useRef<HTMLPreElement>(null);
  const selectId = useId();
  const resolvedLanguage =
    normalizeCodeLanguage(language) ?? inferLanguageFromFilename(filename);
  const highlighted = useMemo(
    () => highlightCode(code, resolvedLanguage),
    [resolvedLanguage, code],
  );

  // Auto-grow to content height — no drag-to-resize handle.
  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [code]);

  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const layer = highlightLayerRef.current;
    if (!layer) return;
    layer.scrollLeft = event.currentTarget.scrollLeft;
  };

  return (
    <div
      className={cn(
        "plan-code plan-code-editing group relative",
        !editable && "opacity-60",
      )}
    >
      <div className="plan-code-head">
        <span className="plan-code-filename plan-code-muted">
          <IconCode className="size-4 shrink-0 opacity-70" />
          {filename || "Snippet"}
        </span>
        <span className="plan-code-chrome">
          <label htmlFor={selectId} className="sr-only">
            Code language
          </label>
          <select
            id={selectId}
            data-plan-interactive
            disabled={!editable}
            className="plan-code-lang-select"
            value={normalizeCodeLanguage(language) ? (language ?? "") : ""}
            onChange={(event) =>
              onLanguageChange(event.target.value || undefined)
            }
          >
            {CODE_LANGUAGES.map((option) => (
              <option key={option.value || "auto"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <CopyButton value={code} />
        </span>
      </div>
      <div className="plan-code-editor-body">
        <pre
          ref={highlightLayerRef}
          aria-hidden="true"
          className="plan-code-editor-layer"
        >
          <code>
            {highlighted}
            {code.endsWith("\n") ? " " : null}
          </code>
        </pre>
        <textarea
          ref={textareaRef}
          data-plan-interactive
          spellCheck={false}
          wrap="off"
          className="plan-code-editor-input"
          value={code}
          disabled={!editable}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
            onCodeChange(event.target.value)
          }
          onScroll={syncScroll}
        />
      </div>
    </div>
  );
}

function CodeEdit({ data, onChange, editable }: BlockEditProps<CodeData>) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <CodeEditorSurface
        code={data.code}
        language={data.language}
        filename={data.filename}
        editable={editable}
        onCodeChange={(code) => onChange({ ...data, code })}
        onLanguageChange={(language) => onChange({ ...data, language })}
      />
      {editable && (
        <input
          type="text"
          data-plan-interactive
          className="plan-code-caption-input"
          placeholder="Caption (optional)"
          value={data.caption ?? ""}
          onChange={(event) =>
            onChange({ ...data, caption: event.target.value || undefined })
          }
        />
      )}
    </div>
  );
}

/* ── Spec ──────────────────────────────────────────────────────────────────── */

export const codeBlock = defineBlock<CodeData>({
  type: "code",
  schema: codeSchema,
  mdx: codeMdx,
  Read: CodeRead,
  Edit: CodeEdit,
  placement: ["block"],
  editSurface: "inline",
  label: "Code",
  icon: IconCode,
  description:
    "A single syntax-highlighted code snippet, Notion-style: one border, a hover language switcher + copy, and collapse-to-N lines. Put several in a `tabs` block for a file rail.",
});
