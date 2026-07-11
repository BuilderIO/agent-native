/**
 * `@agent-native/core/brand-kit`
 *
 * The shared, template-agnostic Brand Kit surface. A Brand Kit unifies what
 * `design` and `slides` previously copy-pasted as a "design system": design
 * tokens + brand assets + custom instructions, extractable from code,
 * GitHub, a URL, or documents, and used to generate on-brand content.
 *
 * This module is pure (no `defineAction`, no DB, no template imports). Templates
 * keep their own `design_systems` schema table and thin `defineAction` wrappers
 * (which handle DB access + auto-registration), and import the reusable types
 * and helpers from here.
 *
 * Re-exports the lower-level import/token-extraction helpers from
 * `design-token-utils` so callers have a single Brand Kit entry point.
 */

export * from "./types.js";
export * from "./brand-signals.js";

// Import-source parsing + token extraction (Tailwind/CSS/GitHub/URL/document/
// code analysis). These already power the import-* actions across templates.
export {
  // URL extraction
  extractDesignTokensFromUrl,
  validateUrl,
  // GitHub helpers
  parseOwnerRepo,
  fetchGitHubJson,
  fetchGitHubJsonResult,
  fetchGitHubRaw,
  // Tailwind / CSS parsing
  parseTailwindConfig,
  parseCss,
  detectStylingFramework,
  // Code-file analysis
  createCodeAnalysisState,
  analyzeCodeFile,
  analyzeCssFile,
  analyzeTailwindConfig,
  analyzeJsonTheme,
  analyzePackageJson,
  analyzeThemeSourceFile,
  addFont,
  extractCssVars,
  extractCodeColors,
  extractCodeFonts,
  // Document analysis
  extractDocumentColors,
  extractDocumentFonts,
  classifyFile,
  suggestionsForType,
  unique,
  // Constants
  MAX_FILES,
  MAX_FILE_SIZE,
  FETCH_TIMEOUT,
  ROOT_PATTERNS,
  SECONDARY_PATHS,
  CODE_MAX_FILES,
  CODE_MAX_TOTAL_BYTES,
} from "../server/design-token-utils.js";

export type {
  ContentType,
  ParsedCss,
  ParsedTailwindConfig,
  CodeAnalysisState,
  UrlExtractionResult,
  GitHubFetchOptions,
  GitHubJsonResult,
} from "../server/design-token-utils.js";
