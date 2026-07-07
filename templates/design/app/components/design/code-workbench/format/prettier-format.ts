/**
 * Prettier formatting for the code workbench. Prettier's browser bundle
 * (`prettier/standalone`) and per-language plugins are loaded lazily via
 * dynamic import so the initial workbench bundle stays lean — most sessions
 * never touch a language whose plugin hasn't loaded yet. `monaco-editor`
 * itself is also imported lazily (only inside `registerPrettierFormatting`)
 * so this module stays safe to import from node-side (non-DOM) unit tests.
 */

type PrettierStandalone = typeof import("prettier/standalone");

type SupportedLanguage =
  | "html"
  | "css"
  | "javascript"
  | "typescript"
  | "json"
  | "markdown";

interface FormatSpec {
  parser: string;
  /** Dynamic plugin module loaders, in the order Prettier expects them. */
  plugins: Array<() => Promise<unknown>>;
}

const FORMAT_SPECS: Record<SupportedLanguage, FormatSpec> = {
  html: {
    parser: "html",
    plugins: [
      () => import("prettier/plugins/html"),
      () => import("prettier/plugins/postcss"),
      () => import("prettier/plugins/babel"),
      () => import("prettier/plugins/estree"),
    ],
  },
  css: {
    parser: "css",
    plugins: [() => import("prettier/plugins/postcss")],
  },
  javascript: {
    parser: "babel",
    plugins: [
      () => import("prettier/plugins/babel"),
      () => import("prettier/plugins/estree"),
    ],
  },
  typescript: {
    parser: "typescript",
    plugins: [
      () => import("prettier/plugins/typescript"),
      () => import("prettier/plugins/estree"),
    ],
  },
  json: {
    parser: "json",
    plugins: [
      () => import("prettier/plugins/babel"),
      () => import("prettier/plugins/estree"),
    ],
  },
  markdown: {
    parser: "markdown",
    plugins: [() => import("prettier/plugins/markdown")],
  },
};

/** Extension → supported-language mapping used to pick the format spec. */
function languageForFormatting(path: string): SupportedLanguage | null {
  if (/\.(html?|vue|svelte|astro)$/i.test(path)) return "html";
  if (/\.(css|scss|less)$/i.test(path)) return "css";
  if (/\.(jsx?|mjs|cjs)$/i.test(path)) return "javascript";
  if (/\.tsx?$/i.test(path)) return "typescript";
  if (/\.json$/i.test(path)) return "json";
  if (/\.(md|mdx)$/i.test(path)) return "markdown";
  return null;
}

export function isFormattablePath(path: string): boolean {
  return languageForFormatting(path) !== null;
}

let standaloneModulePromise: Promise<PrettierStandalone> | null = null;
function loadStandalone(): Promise<PrettierStandalone> {
  if (!standaloneModulePromise) {
    standaloneModulePromise = import("prettier/standalone");
  }
  return standaloneModulePromise;
}

// Cache loaded plugin modules per language so repeated formats (and repeated
// tabs of the same language) don't re-import.
const pluginModulesCache = new Map<SupportedLanguage, Promise<unknown[]>>();
function loadPlugins(language: SupportedLanguage): Promise<unknown[]> {
  let cached = pluginModulesCache.get(language);
  if (!cached) {
    cached = Promise.all(FORMAT_SPECS[language].plugins.map((load) => load()));
    pluginModulesCache.set(language, cached);
  }
  return cached;
}

export type FormatResult = { formatted: string } | { error: string };

/**
 * Format `content` for the file at `path` using Prettier. Never throws —
 * parse/format failures are returned as `{ error }` so callers (format on
 * open, the Monaco formatting provider) can fail soft.
 */
export async function formatWithPrettier(
  content: string,
  path: string,
): Promise<FormatResult> {
  const language = languageForFormatting(path);
  if (!language) {
    return {
      error: `No formatter available for this file type` /* i18n-ignore */,
    };
  }
  try {
    const [prettier, plugins] = await Promise.all([
      loadStandalone(),
      loadPlugins(language),
    ]);
    const formatted = await prettier.format(content, {
      parser: FORMAT_SPECS[language].parser,
      plugins: plugins as never,
      printWidth: 100,
      tabWidth: 2,
    });
    return { formatted };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not format file" /* i18n-ignore */,
    };
  }
}

const MONACO_FORMAT_LANGUAGES = [
  "html",
  "css",
  "javascript",
  "typescript",
  "json",
  "markdown",
];

let prettierFormattingRegistered = false;

/**
 * Register a Monaco DocumentFormattingEditProvider backed by Prettier for
 * html/css/javascript/typescript/json/markdown, so Shift+Alt+F and the
 * editor's "Format Document" context-menu action work. Idempotent — safe to
 * call multiple times (e.g. across CodeWorkbench remounts).
 */
export function registerPrettierFormatting(): void {
  if (prettierFormattingRegistered || typeof window === "undefined") return;
  prettierFormattingRegistered = true;
  void (async () => {
    const monaco: typeof import("monaco-editor") =
      await import("monaco-editor");
    for (const language of MONACO_FORMAT_LANGUAGES) {
      monaco.languages.registerDocumentFormattingEditProvider(language, {
        async provideDocumentFormattingEdits(model) {
          const path = model.uri.path.replace(/^\/+/, "");
          const content = model.getValue();
          const result = await formatWithPrettier(content, path);
          if ("error" in result) return [];
          if (result.formatted === content) return [];
          return [
            {
              range: model.getFullModelRange(),
              text: result.formatted,
            },
          ];
        },
      });
    }
  })();
}
