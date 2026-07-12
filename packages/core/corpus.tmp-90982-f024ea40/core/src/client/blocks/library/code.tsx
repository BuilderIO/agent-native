import { IconCheck, IconCode, IconCopy, IconPencil } from "@tabler/icons-react";
import {
  useId,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type UIEvent,
} from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.js";
import { cn } from "../../utils.js";
import { ltrCodeBlockProps } from "../code-block-direction.js";
import { defineBlock } from "../types.js";
import type { BlockReadProps, BlockEditProps } from "../types.js";
import { CodeFilenameLabel } from "./code-filename-label.js";
import {
  highlightCode,
  inferLanguageFromFilename,
  normalizeCodeLanguage,
} from "./code-highlight.js";
import { codeSchema, codeMdx, type CodeData } from "./code.config.js";
import { CodeSurface, DEFAULT_CODE_MAX_LINES } from "./HighlightedCode.js";

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
  const hasFilename = Boolean(data.filename?.trim());
  return (
    <section
      {...ltrCodeBlockProps}
      className="plan-block"
      data-block-id={blockId}
    >
      <div className="plan-code group relative">
        {hasFilename && (
          <div className="plan-code-head">
            <span className="plan-code-filename">
              <IconCode className="size-4 shrink-0 opacity-70" />
              <CodeFilenameLabel
                filename={data.filename}
                directoryClassName="text-plan-muted"
                basenameClassName="text-plan-text"
              />
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
          showLanguageLabel={false}
        />
        {!hasFilename && (
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

const SETTINGS_INPUT =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** Hover "settings" (pencil) → popover to edit the filename + max-lines cap. */
function CodeSettingsPopover({
  filename,
  maxLines,
  onFilenameChange,
  onMaxLinesChange,
}: {
  filename?: string;
  maxLines?: number;
  onFilenameChange: (filename: string | undefined) => void;
  onMaxLinesChange: (maxLines: number | undefined) => void;
}) {
  const [filenameDraft, setFilenameDraft] = useState(filename ?? "");

  useEffect(() => {
    setFilenameDraft(filename ?? "");
  }, [filename]);

  const commitFilename = () => {
    const next = filenameDraft.trim();
    onFilenameChange(next || undefined);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-plan-interactive
          aria-label="Code block settings"
          title="Code block settings"
          className="plan-code-chip"
        >
          <IconPencil className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        className="w-64 p-0"
        data-plan-interactive
      >
        <div className="border-b border-border px-3 py-2 text-sm font-semibold text-foreground">
          Code block
        </div>
        <div className="grid gap-3 p-3">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Filename
            </span>
            <input
              type="text"
              data-plan-interactive
              className={SETTINGS_INPUT}
              placeholder="src/file.ts"
              value={filenameDraft}
              onBlur={commitFilename}
              onChange={(event) => setFilenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitFilename();
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  setFilenameDraft(filename ?? "");
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Max lines before expand
            </span>
            <input
              type="number"
              min={0}
              step={1}
              data-plan-interactive
              className={SETTINGS_INPUT}
              placeholder={`${DEFAULT_CODE_MAX_LINES} (default) · 0 = no limit`}
              value={maxLines ?? ""}
              onChange={(event) => {
                const raw = event.target.value.trim();
                const parsed = raw === "" ? undefined : Number(raw);
                onMaxLinesChange(
                  parsed === undefined || Number.isNaN(parsed)
                    ? undefined
                    : Math.max(0, Math.min(2000, Math.floor(parsed))),
                );
              }}
            />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CodeEditorSurface({
  code,
  language,
  filename,
  maxLines,
  editable,
  onCodeChange,
  onLanguageChange,
  onFilenameChange,
  onMaxLinesChange,
}: {
  code: string;
  language?: string;
  filename?: string;
  maxLines?: number;
  editable: boolean;
  onCodeChange: (code: string) => void;
  onLanguageChange: (language: string | undefined) => void;
  onFilenameChange: (filename: string | undefined) => void;
  onMaxLinesChange: (maxLines: number | undefined) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const highlightLayerRef = useRef<HTMLPreElement>(null);
  const selectId = useId();
  const resolvedLanguage =
    normalizeCodeLanguage(language) ?? inferLanguageFromFilename(filename);
  const highlighted = useMemo(
    () => highlightCode(code, resolvedLanguage),
    [resolvedLanguage, code],
  );
  // Size the editor to its content by line count — deterministic, no layout
  // measurement. `wrap="off"` means one row per line. Long snippets collapse to
  // `cap` lines behind a "Show N more lines" toggle, matching the read surface
  // and the file-tree block. `maxLines` omitted ⇒ DEFAULT (40); `0` ⇒ never
  // collapse (show everything).
  const lineCount = code ? code.split("\n").length : 1;
  const cap =
    maxLines == null ? DEFAULT_CODE_MAX_LINES : maxLines > 0 ? maxLines : null;
  const collapsible = cap != null && lineCount > cap;
  const collapsed = collapsible && !expanded;
  const hiddenLines = collapsible ? lineCount - (cap as number) : 0;
  const rows = collapsed ? (cap as number) : lineCount + 1;
  const hasFilename = Boolean(filename?.trim());

  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const layer = highlightLayerRef.current;
    if (!layer) return;
    layer.scrollLeft = event.currentTarget.scrollLeft;
    layer.scrollTop = event.currentTarget.scrollTop;
  };

  const chrome = (
    <>
      <label htmlFor={selectId} className="sr-only">
        Code language
      </label>
      <select
        id={selectId}
        data-plan-interactive
        disabled={!editable}
        className="plan-code-lang-select"
        value={normalizeCodeLanguage(language) ? (language ?? "") : ""}
        onChange={(event) => onLanguageChange(event.target.value || undefined)}
      >
        {CODE_LANGUAGES.map((option) => (
          <option key={option.value || "auto"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {editable && (
        <CodeSettingsPopover
          filename={filename}
          maxLines={maxLines}
          onFilenameChange={onFilenameChange}
          onMaxLinesChange={onMaxLinesChange}
        />
      )}
      <CopyButton value={code} />
    </>
  );

  return (
    <div
      {...ltrCodeBlockProps}
      className={cn(
        "plan-code plan-code-editing group relative",
        !hasFilename && "plan-code-editing--unlabeled",
        !editable && "opacity-60",
      )}
    >
      {hasFilename && (
        <div className="plan-code-head">
          <span className="plan-code-filename plan-code-muted">
            <IconCode className="size-4 shrink-0 opacity-70" />
            <CodeFilenameLabel
              filename={filename}
              directoryClassName="text-plan-muted"
              basenameClassName="text-plan-text"
            />
          </span>
          <span className="plan-code-chrome">{chrome}</span>
        </div>
      )}
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
          data-plan-interactive
          spellCheck={false}
          wrap="off"
          rows={Math.max(3, rows)}
          className="plan-code-editor-input"
          value={code}
          disabled={!editable}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
            onCodeChange(event.target.value)
          }
          onScroll={syncScroll}
        />
        {collapsed && (
          <div className="plan-code-editor-fade" aria-hidden="true" />
        )}
      </div>
      {!hasFilename && (
        <span className="plan-code-chrome plan-code-chrome-float">
          {chrome}
        </span>
      )}
      {collapsible && (
        <button
          type="button"
          data-plan-interactive
          className="plan-code-surface-toggle"
          onClick={() => setExpanded((value) => !value)}
        >
          {collapsed
            ? `Show ${hiddenLines} more line${hiddenLines === 1 ? "" : "s"}`
            : "Show less"}
        </button>
      )}
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
        maxLines={data.maxLines}
        editable={editable}
        onCodeChange={(code) => onChange({ ...data, code })}
        onLanguageChange={(language) => onChange({ ...data, language })}
        onFilenameChange={(filename) => onChange({ ...data, filename })}
        onMaxLinesChange={(maxLines) => onChange({ ...data, maxLines })}
      />
      {editable && (
        <input
          type="text"
          data-plan-interactive
          className="plan-code-caption-input"
          placeholder="Caption"
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
