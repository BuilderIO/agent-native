/**
 * Guard: every visual block embedded in the docs must parse, satisfy its block
 * schema, and render through the same SSR path prod uses. This is what keeps a
 * one-off JSON typo or a bad block field from shipping a broken docs page.
 *
 * It scans the real doc sources in `@agent-native/core/docs/content`, extracts
 * every fenced block segment, and for each one:
 *   1. validates the body against the block's zod schema (precise error), and
 *   2. server-renders it via `renderToStaticMarkup` (catches render crashes).
 *
 * Failures are aggregated so a single run reports every broken block at once.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DocBlock,
  DocBlocksProvider,
  resolveDocBlockType,
  splitDocSegments,
  validateDocBlock,
} from "./docBlocks";

const CONTENT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../core/docs/content",
);
const LOCALES_DIR = join(CONTENT_DIR, "locales");

type LoadedDoc = {
  locale?: string;
  slug: string;
  body: string;
};

function loadDocsFromDir(dir: string, locale?: string): LoadedDoc[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => ({
      locale,
      slug: name.replace(/\.md$/, ""),
      body: readFileSync(join(dir, name), "utf8"),
    }));
}

function loadDocs(): LoadedDoc[] {
  return loadDocsFromDir(CONTENT_DIR);
}

function loadLocalizedDocs(): LoadedDoc[] {
  if (!existsSync(LOCALES_DIR)) return [];
  return readdirSync(LOCALES_DIR)
    .filter((name) => !name.startsWith("."))
    .sort()
    .flatMap((locale) => loadDocsFromDir(join(LOCALES_DIR, locale), locale));
}

function docLabel(doc: LoadedDoc) {
  return doc.locale ? `${doc.locale}/${doc.slug}` : doc.slug;
}

function parseJsonBlockData(segment: {
  alias: string;
  body: string;
}): unknown | undefined {
  if (resolveDocBlockType(segment.alias) === "mermaid") return undefined;
  const trimmed = segment.body.trim();
  if (!trimmed) return undefined;
  return JSON.parse(trimmed) as unknown;
}

function fileTreeSegments(doc: LoadedDoc) {
  return splitDocSegments(doc.body).filter(
    (
      segment,
    ): segment is Extract<
      ReturnType<typeof splitDocSegments>[number],
      { kind: "block" }
    > =>
      segment.kind === "block" &&
      resolveDocBlockType(segment.alias) === "file-tree",
  );
}

function shouldTranslateFileTreeText(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Stable identifiers and literal config snippets stay unchanged in localized
  // file-tree notes; prose titles and comments should not remain English.
  if (trimmed.startsWith("@")) return false;
  if (/^[\w.-]+:\s*\[/.test(trimmed)) return false;
  return /[A-Za-z]/.test(trimmed);
}

describe("docs visual blocks", () => {
  const docs = loadDocs();
  const localizedDocs = loadLocalizedDocs();
  const allDocs = [...docs, ...localizedDocs];
  const docsBySlug = new Map(docs.map((doc) => [doc.slug, doc]));

  it("loads doc sources", () => {
    expect(docs.length).toBeGreaterThan(0);
  });

  // Guard against the splitter SILENTLY skipping a visual fence (e.g. a regex that
  // rejects a valid info string), which would otherwise leak raw JSON into the
  // page AND bypass the schema/render checks below (they only see parsed blocks).
  it("parses every raw an-* fence opener into a block segment", () => {
    const failures: string[] = [];
    for (const doc of allDocs) {
      const rawOpeners = (doc.body.match(/^```an-[\w-]+/gm) ?? []).length;
      const parsedBlocks = splitDocSegments(doc.body).filter(
        (segment) => segment.kind === "block",
      ).length;
      if (parsedBlocks !== rawOpeners) {
        failures.push(
          `${docLabel(doc)}: ${rawOpeners} \`an-*\` openers but ${parsedBlocks} parsed blocks`,
        );
      }
    }
    expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
  });

  it("every embedded block passes its schema", () => {
    const failures: string[] = [];
    for (const doc of allDocs) {
      const segments = splitDocSegments(doc.body);
      segments.forEach((segment, index) => {
        if (segment.kind !== "block") return;
        const result = validateDocBlock(segment.alias, segment.body);
        if (!result.ok) {
          failures.push(
            `${docLabel(doc)} [block #${index} \`${segment.alias}\`]: ${result.error}`,
          );
        }
      });
    }
    expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
  });

  it("every embedded block renders through the SSR path", () => {
    const failures: string[] = [];
    for (const doc of allDocs) {
      const segments = splitDocSegments(doc.body);
      segments.forEach((segment, index) => {
        if (segment.kind !== "block") return;
        try {
          const html = renderToStaticMarkup(
            <DocBlocksProvider>
              <DocBlock
                alias={segment.alias}
                attrs={segment.attrs}
                body={segment.body}
              />
            </DocBlocksProvider>,
          );
          // A rendered DocBlockError surfaces as the only child text; treat the
          // schema test as the source of truth for those and just assert the
          // render produced markup.
          if (!html || html.length === 0) {
            failures.push(`${docLabel(doc)} [block #${index}]: empty render`);
          }
        } catch (error) {
          failures.push(
            `${docLabel(doc)} [block #${index} \`${segment.alias}\`]: render threw — ${
              (error as Error).message
            }`,
          );
        }
      });
    }
    expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
  }, 30_000);

  it("renders stable fallback ids across repeated SSR renders", () => {
    const element = (
      <DocBlocksProvider>
        <DocBlock
          alias="an-callout"
          attrs={{}}
          body='{ "tone": "info", "body": "Stable id" }'
        />
      </DocBlocksProvider>
    );

    expect(renderToStaticMarkup(element)).toBe(renderToStaticMarkup(element));
  });

  it("localizes file-tree prose while preserving paths", () => {
    const failures: string[] = [];
    for (const localizedDoc of localizedDocs) {
      const sourceDoc = docsBySlug.get(localizedDoc.slug);
      if (!sourceDoc) continue;
      const sourceTrees = fileTreeSegments(sourceDoc);
      const localizedTrees = fileTreeSegments(localizedDoc);
      if (localizedTrees.length !== sourceTrees.length) {
        failures.push(
          `${docLabel(localizedDoc)}: ${localizedTrees.length} file-tree blocks but ${sourceTrees.length} in English`,
        );
        continue;
      }

      localizedTrees.forEach((localizedTree, treeIndex) => {
        const sourceTree = sourceTrees[treeIndex];
        const sourceData = parseJsonBlockData(sourceTree) as
          | { entries?: Array<{ path?: unknown; note?: unknown }> }
          | undefined;
        const localizedData = parseJsonBlockData(localizedTree) as
          | { entries?: Array<{ path?: unknown; note?: unknown }> }
          | undefined;

        if (
          shouldTranslateFileTreeText(sourceTree.attrs.title) &&
          localizedTree.attrs.title === sourceTree.attrs.title
        ) {
          failures.push(
            `${docLabel(localizedDoc)} file-tree #${treeIndex}: title still matches English`,
          );
        }

        const sourceEntries = sourceData?.entries ?? [];
        const localizedEntries = localizedData?.entries ?? [];
        const sourcePaths = sourceEntries.map((entry) => entry.path);
        const localizedPaths = localizedEntries.map((entry) => entry.path);
        if (JSON.stringify(localizedPaths) !== JSON.stringify(sourcePaths)) {
          failures.push(
            `${docLabel(localizedDoc)} file-tree #${treeIndex}: paths changed from English source`,
          );
        }

        localizedEntries.forEach((localizedEntry, entryIndex) => {
          const sourceEntry = sourceEntries[entryIndex];
          if (
            shouldTranslateFileTreeText(sourceEntry?.note) &&
            localizedEntry.note === sourceEntry?.note
          ) {
            failures.push(
              `${docLabel(localizedDoc)} file-tree #${treeIndex} \`${String(
                localizedEntry.path,
              )}\`: note still matches English`,
            );
          }
        });
      });
    }

    expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
  });
});
