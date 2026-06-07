import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type UIEvent,
} from "react";
import { IconCode, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { common, createLowlight } from "lowlight";
import { cn } from "../../utils.js";
import { defineBlock } from "../types.js";
import type { BlockReadProps, BlockEditProps } from "../types.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.js";
import { CodeSurface } from "./HighlightedCode.js";
import {
  codeTabsSchema,
  codeTabsMdx,
  type CodeTabsData,
  type CodeTabsTab,
} from "./code-tabs.config.js";

/**
 * Standard `code-tabs` block (STANDARD core library): a vertical file tab rail
 * with Shiki-highlighted code panes. Moved verbatim from the plan
 * `CodeTabsBlock` (`DocumentArea.tsx`) so its rendered output is unchanged, then
 * generalized to the registry `Read`/`Edit` contract. Shareable by any app that
 * registers the core block library.
 *
 * `Edit` is hybrid: each tab's `code` field renders as a code-style monospace
 * text area, while tab metadata (label/language/caption/add/remove) stays in a
 * settings popover so the document surface only exposes authored content.
 */

/* ── Syntax highlighting helpers ──────────────────────────────────────────── */

const lowlight = createLowlight(common);

type LowlightNode = {
  type: string;
  value?: string;
  properties?: {
    className?: string[] | string;
  };
  children?: LowlightNode[];
};

const LANGUAGE_ALIASES: Record<string, string> = {
  cjs: "javascript",
  cts: "typescript",
  htm: "html",
  js: "javascript",
  jsonc: "json",
  jsx: "jsx",
  md: "markdown",
  mdx: "markdown",
  mjs: "javascript",
  mts: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "tsx",
  yml: "yaml",
  zsh: "bash",
};

const TOKEN_CLASS_NAMES: Record<string, string> = {
  "hljs-addition": "text-emerald-700 dark:text-emerald-300",
  "hljs-attr": "text-sky-700 dark:text-sky-300",
  "hljs-attribute": "text-sky-700 dark:text-sky-300",
  "hljs-built_in": "text-amber-700 dark:text-amber-300",
  "hljs-bullet": "text-primary",
  "hljs-comment": "text-muted-foreground italic",
  "hljs-deletion": "text-destructive",
  "hljs-doctag": "text-destructive",
  "hljs-emphasis": "italic",
  "hljs-formula": "text-destructive",
  "hljs-keyword": "text-rose-700 dark:text-rose-300",
  "hljs-link": "text-primary underline-offset-2",
  "hljs-literal": "text-violet-700 dark:text-violet-300",
  "hljs-meta": "text-primary",
  "hljs-meta-string": "text-emerald-700 dark:text-emerald-300",
  "hljs-name": "text-emerald-700 dark:text-emerald-300",
  "hljs-number": "text-sky-700 dark:text-sky-300",
  "hljs-params": "text-sky-700 dark:text-sky-300",
  "hljs-property": "text-sky-700 dark:text-sky-300",
  "hljs-quote": "text-muted-foreground italic",
  "hljs-regexp": "text-emerald-700 dark:text-emerald-300",
  "hljs-section": "text-violet-700 dark:text-violet-300",
  "hljs-selector-attr": "text-primary",
  "hljs-selector-class": "text-emerald-700 dark:text-emerald-300",
  "hljs-selector-id": "text-emerald-700 dark:text-emerald-300",
  "hljs-selector-pseudo": "text-primary",
  "hljs-selector-tag": "text-emerald-700 dark:text-emerald-300",
  "hljs-string": "text-emerald-700 dark:text-emerald-300",
  "hljs-strong": "font-semibold",
  "hljs-subst": "text-destructive",
  "hljs-symbol": "text-primary",
  "hljs-tag": "text-emerald-700 dark:text-emerald-300",
  "hljs-template-variable": "text-amber-700 dark:text-amber-300",
  "hljs-title": "text-violet-700 dark:text-violet-300",
  "hljs-type": "text-amber-700 dark:text-amber-300",
  "hljs-variable": "text-amber-700 dark:text-amber-300",
  language_: "text-amber-700 dark:text-amber-300",
};

function normalizeCodeLanguage(value?: string | null): string | null {
  const raw = value
    ?.trim()
    .toLowerCase()
    .replace(/^language-/, "");
  if (!raw) return null;
  const normalized = LANGUAGE_ALIASES[raw] ?? raw;
  return lowlight.registered(normalized) ? normalized : null;
}

function inferLanguageFromFilename(filename?: string | null): string | null {
  const basename = filename?.split("/").pop()?.toLowerCase();
  if (!basename) return null;
  if (basename === "dockerfile") return normalizeCodeLanguage("bash");
  const extension = basename.includes(".")
    ? basename.split(".").pop()
    : undefined;
  return normalizeCodeLanguage(extension);
}

function codeTabLanguage(tab?: CodeTabsTab): string | undefined {
  return (
    normalizeCodeLanguage(tab?.language) ??
    inferLanguageFromFilename(tab?.label) ??
    undefined
  );
}

function tokenClassName(value: string[] | string | undefined): string {
  const classes = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\s+/)
      : [];
  return classes
    .map((className) => TOKEN_CLASS_NAMES[className] ?? "")
    .filter(Boolean)
    .join(" ");
}

function hastToReact(children: LowlightNode[], keyPrefix: string): ReactNode[] {
  return children.map((node, index) => {
    if (node.type === "text") return node.value ?? "";
    if (node.type === "element") {
      const key = `${keyPrefix}${index}`;
      const renderedChildren = node.children?.length
        ? hastToReact(node.children, `${key}-`)
        : null;
      const className = tokenClassName(node.properties?.className);
      return (
        <span key={key} className={className || undefined}>
          {renderedChildren}
        </span>
      );
    }
    return null;
  });
}

function highlightCode(code: string, language?: string): ReactNode {
  const normalized = normalizeCodeLanguage(language);
  if (!normalized || normalized === "plaintext" || normalized === "text") {
    return code;
  }
  try {
    const tree = lowlight.highlight(normalized, code) as LowlightNode;
    return hastToReact(tree.children ?? [], `${normalized}-`);
  } catch {
    return code;
  }
}

/* ── Read (vertical tab rail + Shiki) ──────────────────────────────────────── */

function CodeTabsRead({ data, blockId, title }: BlockReadProps<CodeTabsData>) {
  const [activeId, setActiveId] = useState(data.tabs[0]?.id ?? "");
  const active = data.tabs.find((tab) => tab.id === activeId) ?? data.tabs[0];
  return (
    <section className="plan-block" data-block-id={blockId}>
      {title && <div className="plan-block-label">{title}</div>}
      <div className="grid overflow-hidden border-y border-plan-line md:grid-cols-[300px_minmax(0,1fr)]">
        <div className="border-plan-line md:border-r">
          {data.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-plan-interactive
              className={cn(
                "flex w-full items-start gap-3 border-b border-plan-line px-4 py-4 text-left",
                tab.id === active?.id
                  ? "bg-primary/10 text-plan-text dark:bg-primary/20"
                  : "text-plan-muted hover:bg-accent/30",
              )}
              onClick={() => setActiveId(tab.id)}
            >
              <IconCode className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate font-mono text-sm font-semibold">
                  {tab.label}
                </span>
                {tab.caption && (
                  <span className="mt-1 block text-xs leading-5">
                    {tab.caption}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
        <div className="min-w-0 p-5">
          {active && (
            <>
              <h3 className="text-2xl font-semibold tracking-tight">
                {active.label}
              </h3>
              {active.caption && (
                <p className="mt-2 text-plan-muted">{active.caption}</p>
              )}
              <CodeSurface
                code={active.code}
                language={codeTabLanguage(active)}
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── Edit (code text areas per tab) ────────────────────────────────────────── */

const inputClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** Mint a reasonably-unique code-tab id without pulling a dep into core. */
function newCodeTabId(): string {
  return `code-tab-${Math.random().toString(36).slice(2, 10)}`;
}

function HighlightedCodeTextarea({
  value,
  language,
  label,
  editable,
  onChange,
}: {
  value: string;
  language?: string;
  label?: string;
  editable: boolean;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
}) {
  const highlightLayerRef = useRef<HTMLPreElement>(null);
  const resolvedLanguage =
    normalizeCodeLanguage(language) ?? inferLanguageFromFilename(label);
  const highlighted = useMemo(
    () => highlightCode(value, resolvedLanguage ?? undefined),
    [resolvedLanguage, value],
  );

  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const layer = highlightLayerRef.current;
    if (!layer) return;
    layer.scrollTop = event.currentTarget.scrollTop;
    layer.scrollLeft = event.currentTarget.scrollLeft;
  };

  return (
    <div
      className={cn(
        "relative min-h-[140px] overflow-hidden rounded-md border border-input bg-background text-foreground focus-within:ring-1 focus-within:ring-ring",
        !editable && "cursor-not-allowed opacity-50",
      )}
      data-code-tabs-highlighted-editor
    >
      <pre
        ref={highlightLayerRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre px-3 py-2 font-mono text-xs leading-5"
        data-code-tabs-highlight-layer
      >
        <code>
          {highlighted}
          {value.endsWith("\n") ? " " : null}
        </code>
      </pre>
      <textarea
        data-plan-interactive
        spellCheck={false}
        wrap="off"
        className={cn(
          "relative z-10 block min-h-[140px] w-full resize-y overflow-auto rounded-md border-0 bg-transparent px-3 py-2 font-mono text-xs leading-5 caret-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
          value ? "text-transparent" : "text-muted-foreground",
        )}
        value={value}
        disabled={!editable}
        onChange={onChange}
        onScroll={syncScroll}
      />
    </div>
  );
}

/**
 * Editor: a file-tab strip (one tab active at a time) with the active tab's code
 * editable inline. Tab metadata is edited from the settings popover, mirroring
 * the standard `tabs` block and keeping schema-ish controls out of the document.
 */
function CodeTabsEdit({
  data,
  onChange,
  editable,
}: BlockEditProps<CodeTabsData>) {
  const [activeId, setActiveId] = useState(data.tabs[0]?.id ?? "");
  const active = data.tabs.find((tab) => tab.id === activeId) ?? data.tabs[0];

  const commit = (tabs: CodeTabsTab[]) => onChange({ tabs });

  const updateTab = (id: string, patch: Partial<CodeTabsTab>) =>
    commit(
      data.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)),
    );

  const removeTab = (id: string) => {
    const next = data.tabs.filter((tab) => tab.id !== id);
    if (next.length === 0) return; // tabs must keep at least one (schema min 1)
    commit(next);
    if (activeId === id) setActiveId(next[0]?.id ?? "");
  };

  const addTab = () => {
    if (data.tabs.length >= 12) return; // schema max
    const id = newCodeTabId();
    commit([
      ...data.tabs,
      { id, label: `file-${data.tabs.length + 1}.ts`, code: "" },
    ]);
    setActiveId(id);
  };

  return (
    <div className="an-code-tabs-editor flex min-w-0 flex-col gap-4">
      <div className="flex w-full min-w-0 items-start gap-2">
        <div
          className="flex w-full min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-x-auto"
          role="tablist"
          data-plan-interactive
        >
          {data.tabs.map((tab) => {
            const selected = tab.id === active?.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveId(tab.id)}
                className={cn(
                  "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-transparent px-3 py-2 font-mono text-sm font-semibold transition-colors",
                  selected
                    ? "bg-primary/10 text-plan-text dark:bg-primary/20"
                    : "text-plan-muted hover:bg-plan-block/60 hover:text-plan-text",
                )}
              >
                <IconCode className="size-4 shrink-0" />
                {tab.label}
              </button>
            );
          })}
        </div>
        {editable && (
          <CodeTabsSettingsPopover
            active={active}
            tabs={data.tabs}
            onUpdate={updateTab}
            onAdd={addTab}
            onRemove={removeTab}
          />
        )}
      </div>
      {active && (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Code
          </span>
          <HighlightedCodeTextarea
            value={active.code}
            editable={editable}
            label={active.label}
            language={active.language}
            onChange={(event) =>
              updateTab(active.id, { code: event.target.value })
            }
          />
        </label>
      )}
    </div>
  );
}

function CodeTabsSettingsPopover({
  active,
  tabs,
  onUpdate,
  onAdd,
  onRemove,
}: {
  active: CodeTabsTab | undefined;
  tabs: CodeTabsTab[];
  onUpdate: (id: string, patch: Partial<CodeTabsTab>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-plan-interactive
          aria-label="Edit code tabs"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-plan-muted transition-colors hover:text-plan-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <IconPencil className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        className="w-80 p-0"
        data-plan-interactive
      >
        <div className="border-b border-border px-3 py-2">
          <div className="text-sm font-semibold text-foreground">
            Code tab settings
          </div>
          <div className="text-xs text-muted-foreground">
            Rename the active tab or manage its metadata.
          </div>
        </div>
        <div className="grid gap-3 p-3">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Active tab label
            </span>
            <input
              type="text"
              data-plan-interactive
              className={inputClass}
              value={active?.label ?? ""}
              disabled={!active}
              onChange={(event) => {
                if (!active) return;
                onUpdate(active.id, { label: event.target.value });
              }}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Language
            </span>
            <input
              type="text"
              data-plan-interactive
              className={inputClass}
              value={active?.language ?? ""}
              disabled={!active}
              onChange={(event) => {
                if (!active) return;
                onUpdate(active.id, {
                  language: event.target.value || undefined,
                });
              }}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Caption
            </span>
            <input
              type="text"
              data-plan-interactive
              className={inputClass}
              value={active?.caption ?? ""}
              disabled={!active}
              onChange={(event) => {
                if (!active) return;
                onUpdate(active.id, {
                  caption: event.target.value || undefined,
                });
              }}
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-plan-interactive
              disabled={tabs.length >= 12}
              onClick={onAdd}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconPlus className="size-3.5" />
              Add tab
            </button>
            <button
              type="button"
              data-plan-interactive
              disabled={!active || tabs.length <= 1}
              onClick={() => {
                if (!active) return;
                onRemove(active.id);
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconTrash className="size-3.5" />
              Remove current
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ── Spec ──────────────────────────────────────────────────────────────────── */

export const codeTabsBlock = defineBlock<CodeTabsData>({
  type: "code-tabs",
  schema: codeTabsSchema,
  mdx: codeTabsMdx,
  Read: CodeTabsRead,
  Edit: CodeTabsEdit,
  placement: ["block"],
  editSurface: "inline",
  label: "Code tabs",
  icon: IconCode,
  description:
    "A vertical file tab rail of syntax-highlighted code snippets, one tab per file with an optional language and caption.",
});
