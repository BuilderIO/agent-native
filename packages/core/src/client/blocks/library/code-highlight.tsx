import type { ReactNode } from "react";
import { common, createLowlight } from "lowlight";

/**
 * Shared synchronous syntax highlighter for the dev-doc code blocks. Wraps
 * `lowlight` (highlight.js grammars over a HAST tree) and converts the tree to
 * React nodes whose tokens carry theme-aware Tailwind classes, so a caller can
 * highlight a whole snippet OR a single line and drop the result straight into
 * JSX. This is the same colorful palette the `code-tabs` block uses, extracted so
 * blocks that need per-line control (annotated-code's highlight bands, future
 * line-anchored surfaces) render identical syntax colors instead of forking yet
 * another token map. `DiffBlock` keeps its own muted palette on purpose (its
 * syntax colors must not fight the add/removed line tints), so it is not a
 * consumer here.
 *
 * Per-line use is the reason this is sync (lowlight, not async Shiki): a block
 * that puts a band/gutter marker on specific lines highlights each line on its
 * own with no loading state.
 */

const lowlight = createLowlight(common);

type LowlightNode = {
  type: string;
  value?: string;
  properties?: { className?: string[] | string };
  children?: LowlightNode[];
};

/** Common extension / shorthand → registered highlight.js language name. */
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

/**
 * highlight.js token class → Tailwind classes. Colorful palette (keywords rose,
 * numbers/attrs sky, literals/titles violet, strings/tags emerald, types/builtins
 * amber) with `dark:` pairs so it reads in both themes. Kept value-identical to
 * the `code-tabs` block's map.
 */
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

/**
 * Normalize a user-supplied language hint to a registered highlight.js grammar,
 * or `null` when empty / unknown so callers fall back to plain text.
 */
export function normalizeCodeLanguage(value?: string | null): string | null {
  const raw = value
    ?.trim()
    .toLowerCase()
    .replace(/^language-/, "");
  if (!raw) return null;
  const normalized = LANGUAGE_ALIASES[raw] ?? raw;
  return lowlight.registered(normalized) ? normalized : null;
}

/** Best-effort language from a filename / path extension (e.g. `auth.ts` → ts). */
export function inferLanguageFromFilename(
  filename?: string | null,
): string | null {
  const basename = filename?.split("/").pop()?.toLowerCase();
  if (!basename) return null;
  if (basename === "dockerfile") return normalizeCodeLanguage("bash");
  if (basename === "makefile") return normalizeCodeLanguage("makefile");
  const extension = basename.includes(".")
    ? basename.split(".").pop()
    : undefined;
  return normalizeCodeLanguage(extension);
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

/**
 * Syntax-highlight `code` for an already-resolved language, returning React
 * token nodes. Pass a single line to highlight per-line (the annotated-code use)
 * or a whole snippet. Falls back to the raw string for empty / plaintext /
 * unknown languages or any grammar error, so it is always safe to render.
 */
export function highlightCode(
  code: string,
  language?: string | null,
): ReactNode {
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
