import { useEffect, useState } from "react";
import { IconCode } from "@tabler/icons-react";
import { cn } from "../../utils.js";
import { defineBlock } from "../types.js";
import type { BlockReadProps, BlockEditProps } from "../types.js";
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
 * `Edit` is schema-driven in spirit: each tab's `code` field renders as a
 * code-style monospace text area (the plain auto-editor can't descend into the
 * `tabs` array), plus label/language/caption inputs. The component owns no app
 * services, so it stays portable across apps.
 */

/* ── Read (vertical tab rail + Shiki) ──────────────────────────────────────── */

function CodeTabsRead({ data, blockId, title }: BlockReadProps<CodeTabsData>) {
  const [activeId, setActiveId] = useState(data.tabs[0]?.id ?? "");
  const active = data.tabs.find((tab) => tab.id === activeId) ?? data.tabs[0];
  return (
    <section className="plan-block" data-block-id={blockId}>
      {title && <h2>{title}</h2>}
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
                  ? "bg-plan-block text-plan-text shadow-[inset_3px_0_0_hsl(var(--ring))]"
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
              <CodeSurface code={active.code} language={active.language} />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function CodeSurface({
  code,
  language,
  className,
}: {
  code: string;
  language?: string;
  className?: string;
}) {
  return (
    <div className={cn("plan-code-surface", className ?? "mt-5")}>
      <HighlightedCode code={code} language={language} />
    </div>
  );
}

/* ── Edit (code text areas per tab) ────────────────────────────────────────── */

const inputClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const codeAreaClass =
  "flex min-h-[140px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs leading-5 shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function CodeTabsEdit({
  data,
  onChange,
  editable,
}: BlockEditProps<CodeTabsData>) {
  const updateTab = (id: string, patch: Partial<CodeTabsTab>) => {
    onChange({
      tabs: data.tabs.map((tab) =>
        tab.id === id ? { ...tab, ...patch } : tab,
      ),
    });
  };
  return (
    <div className="an-code-tabs-editor flex flex-col gap-5">
      {data.tabs.map((tab) => (
        <div
          key={tab.id}
          className="flex flex-col gap-2 rounded-md border border-input p-3"
        >
          <div className="grid gap-2 md:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Label
              </span>
              <input
                type="text"
                data-plan-interactive
                className={inputClass}
                value={tab.label}
                disabled={!editable}
                onChange={(event) =>
                  updateTab(tab.id, { label: event.target.value })
                }
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Language
              </span>
              <input
                type="text"
                data-plan-interactive
                className={inputClass}
                value={tab.language ?? ""}
                disabled={!editable}
                onChange={(event) =>
                  updateTab(tab.id, {
                    language: event.target.value || undefined,
                  })
                }
              />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Caption
            </span>
            <input
              type="text"
              data-plan-interactive
              className={inputClass}
              value={tab.caption ?? ""}
              disabled={!editable}
              onChange={(event) =>
                updateTab(tab.id, { caption: event.target.value || undefined })
              }
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Code
            </span>
            <textarea
              data-plan-interactive
              spellCheck={false}
              className={codeAreaClass}
              value={tab.code}
              disabled={!editable}
              onChange={(event) =>
                updateTab(tab.id, { code: event.target.value })
              }
            />
          </label>
        </div>
      ))}
    </div>
  );
}

/* ── Shiki syntax highlighting (lazy-loaded, single dark theme) ────────────── */
type ShikiHighlighter = {
  codeToHtml: (
    code: string,
    options: { lang: string; theme: string },
  ) => string | Promise<string>;
  getLoadedLanguages: () => string[];
};

let highlighterLoader: Promise<ShikiHighlighter> | null = null;
function loadHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterLoader) {
    highlighterLoader = (async () => {
      const [{ createHighlighterCore }, { createOnigurumaEngine }] =
        await Promise.all([
          import("shiki/core"),
          import("shiki/engine/oniguruma"),
        ]);
      return createHighlighterCore({
        themes: [import("shiki/themes/github-dark-default.mjs")],
        langs: [
          import("shiki/langs/javascript.mjs"),
          import("shiki/langs/typescript.mjs"),
          import("shiki/langs/jsx.mjs"),
          import("shiki/langs/tsx.mjs"),
          import("shiki/langs/json.mjs"),
          import("shiki/langs/css.mjs"),
          import("shiki/langs/html.mjs"),
          import("shiki/langs/markdown.mjs"),
          import("shiki/langs/bash.mjs"),
          import("shiki/langs/shellscript.mjs"),
          import("shiki/langs/python.mjs"),
          import("shiki/langs/yaml.mjs"),
          import("shiki/langs/sql.mjs"),
        ],
        engine: createOnigurumaEngine(import("shiki/wasm")),
      }) as unknown as Promise<ShikiHighlighter>;
    })().catch((error) => {
      highlighterLoader = null;
      throw error;
    });
  }
  return highlighterLoader;
}

const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  py: "python",
  yml: "yaml",
  md: "markdown",
};

function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadHighlighter()
      .then((highlighter) => {
        const requested = (language || "text").toLowerCase();
        const resolved = LANG_ALIASES[requested] ?? requested;
        const loaded = highlighter.getLoadedLanguages();
        const lang = loaded.includes(resolved) ? resolved : "text";
        return highlighter.codeToHtml(code, {
          lang,
          theme: "github-dark-default",
        });
      })
      .then((out) => {
        if (!cancelled) setHtml(out as string);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (html) {
    // Shiki output is generated from plain text by the highlighter itself —
    // it is NOT agent-authored HTML, so this is safe (mirrors core chat).
    return (
      <div className="plan-shiki" dangerouslySetInnerHTML={{ __html: html }} />
    );
  }
  return (
    <pre>
      <code className={language ? `language-${language}` : undefined}>
        {code}
      </code>
    </pre>
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
  label: "Code tabs",
  icon: IconCode,
  description:
    "A vertical file tab rail of syntax-highlighted code snippets, one tab per file with an optional language and caption.",
});
