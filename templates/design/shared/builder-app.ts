/**
 * Builder app helpers for the Design Studio.
 *
 * Provides two capabilities:
 *
 * 1. **Connection status** — resolve whether Builder is configured for the
 *    current request (credentials + project ID), without duplicating Builder
 *    auth logic.  Delegates entirely to the core `resolveBuilderCredentials` /
 *    `resolveIsBuilderBranchingEnabled` helpers; no credential values are
 *    surfaced in return types.
 *
 * 2. **Migration seed** — build the prompt seed handed to the Builder cloud
 *    agent when migrating an inline Alpine/HTML design to a real React + Tailwind
 *    app.  The seed carries:
 *      - The design's semantic HTML (up to `MAX_HTML_BYTES` per file).
 *      - The `:root` CSS custom-property block extracted from each file.
 *      - Any Brand Kit token summary from the linked design system.
 *      - Human-readable migration instructions for the Builder cloud agent.
 *
 * Nothing in this module calls the Builder API directly.  API calls happen in
 * `migrate-inline-design-to-app.ts` (action) via `runBuilderAgent`.
 *
 * Security note: credential values are never included in return types or seed
 * content.  The `resolveBuilderStatus` function returns only boolean flags and
 * the pre-built `connectUrl` from the core browser helpers.
 */

import {
  resolveBuilderBranchProjectId,
  resolveIsBuilderBranchingEnabled,
} from "@agent-native/core/server";
import { resolveHasCompleteBuilderConnection } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

export interface BuilderConnectionStatus {
  connected: boolean;
  builderEnabled: boolean;
  branchProjectId: string;
  ownerEmail: string | null;
}

export interface MigrationSeed {
  prompt: string;
  fileCount: number;
  totalBytes: number;
}

const MAX_SEED_FILES = 10;

const MAX_HTML_BYTES_PER_FILE = 80_000;

// ---------------------------------------------------------------------------
// Connection status
// ---------------------------------------------------------------------------

/**
 * Return the Builder connection status for the current request context.
 *
 * Delegates to core helpers (`resolveHasCompleteBuilderConnection`,
 * `resolveIsBuilderBranchingEnabled`, `resolveBuilderBranchProjectId`) so
 * credential resolution lives in one place and is never duplicated here.
 *
 * Usage:
 * ```ts
 * const status = await resolveBuilderStatus();
 * if (!status.builderEnabled) {
 *   return { cta: "connect-builder" };
 * }
 * ```
 */
export async function resolveBuilderStatus(): Promise<BuilderConnectionStatus> {
  const [connected, builderEnabled, branchProjectId] = await Promise.all([
    resolveHasCompleteBuilderConnection(),
    resolveIsBuilderBranchingEnabled(),
    resolveBuilderBranchProjectId(),
  ]);

  return {
    connected,
    builderEnabled,
    branchProjectId,
    ownerEmail: getRequestUserEmail() ?? null,
  };
}

function extractRootCssVars(html: string): string {
  const matches = [...html.matchAll(/:root\s*\{([^}]*)\}/g)];
  if (matches.length === 0) return "";

  const lines: string[] = [];
  for (const match of matches) {
    const block = match[1] ?? "";
    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("--") && trimmed.includes(":")) {
        lines.push(`  ${trimmed}`);
      }
    }
  }
  return lines.length > 0 ? `:root {\n${lines.join("\n")}\n}` : "";
}

export function buildMigrationSeed(params: {
  title: string;
  files: Array<{
    filename: string;
    content: string;
    fileType: string;
  }>;
  resolvedCssVars?: Record<string, string>;
  brandKitSummary?: string;
}): MigrationSeed {
  const { title, files, resolvedCssVars, brandKitSummary } = params;

  const seedFiles = files.slice(0, MAX_SEED_FILES);
  let totalBytes = 0;

  const fileSections: string[] = [];
  for (const file of seedFiles) {
    const rawBytes = new TextEncoder().encode(file.content).length;
    totalBytes += rawBytes;

    let content = file.content;
    let truncationNote = "";
    if (rawBytes > MAX_HTML_BYTES_PER_FILE) {
      content = file.content.slice(0, MAX_HTML_BYTES_PER_FILE);
      truncationNote = `\n<!-- [TRUNCATED: original file was ${rawBytes} bytes; only the first ${MAX_HTML_BYTES_PER_FILE} bytes are shown] -->`;
    }

    const cssVars = extractRootCssVars(content);

    const section = [
      `### File: ${file.filename}`,
      "```html",
      content,
      truncationNote,
      "```",
      ...(cssVars
        ? [
            "",
            "**Extracted CSS custom properties (design tokens):**",
            "```css",
            cssVars,
            "```",
          ]
        : []),
    ]
      .filter((l) => l !== "")
      .join("\n");

    fileSections.push(section);
  }

  let resolvedVarsBlock = "";
  if (resolvedCssVars && Object.keys(resolvedCssVars).length > 0) {
    const lines = Object.entries(resolvedCssVars)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join("\n");
    resolvedVarsBlock = [
      "",
      "## User-tuned token overrides (apply these values in the real app)",
      "```css",
      `:root {\n${lines}\n}`,
      "```",
    ].join("\n");
  }

  const brandKitBlock =
    brandKitSummary && brandKitSummary.trim()
      ? [
          "",
          "## Brand Kit / Design System tokens",
          brandKitSummary.trim(),
        ].join("\n")
      : "";

  const omittedFilesNote =
    files.length > MAX_SEED_FILES
      ? `\n> Note: ${files.length - MAX_SEED_FILES} additional file(s) were omitted to stay within the prompt limit.\n`
      : "";

  const prompt = [
    `# Migrate inline design to React app: "${title}"`,
    "",
    "You are a Builder cloud agent. The user has an inline Alpine.js / Tailwind HTML prototype",
    "that they want to migrate to a real React + TypeScript + Tailwind app.",
    "",
    "## Your task",
    "1. Convert the HTML prototype below into a production-quality React + TypeScript + Tailwind",
    "   application, preserving the visual design and UX faithfully.",
    "2. Map Alpine.js `x-data` / `x-show` / `x-bind` patterns to React state, conditional",
    "   rendering, and event handlers.",
    "3. Extract inline styles and repeated patterns into reusable React components with",
    "   Tailwind classes.  Preserve the `:root` CSS custom properties as a `globals.css` file",
    "   and wire them into the Tailwind theme config.",
    "4. Carry all design tokens (color, typography, spacing, radius) from the `:root` block",
    "   into the generated `globals.css` and `tailwind.config.ts` so the visual identity is",
    "   identical to the original prototype.",
    "5. Do not introduce placeholder data or lorem ipsum.  Keep the structural content",
    "   from the original design.",
    "6. Use shadcn/ui primitives (Button, Card, Dialog, Input, etc.) where the HTML uses",
    "   semantically equivalent patterns.",
    "7. The app must compile and render without errors.",
    "",
    "## Source design files",
    omittedFilesNote,
    ...fileSections,
    resolvedVarsBlock,
    brandKitBlock,
    "",
    "## Output expectations",
    "- A fully working React app in the current project branch.",
    "- `src/app/globals.css` containing all `:root` CSS custom properties from above.",
    "- `tailwind.config.ts` wiring those vars into the Tailwind theme.",
    "- At least one page component that renders the migrated design.",
    "- All Alpine `x-data` patterns converted to React hooks / state.",
    "- All Tailwind CDN classes preserved as-is in JSX.",
  ]
    .filter((l) => l !== undefined && l !== null)
    .join("\n");

  return {
    prompt,
    fileCount: seedFiles.length,
    totalBytes,
  };
}
