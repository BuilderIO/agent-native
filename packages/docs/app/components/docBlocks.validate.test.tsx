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
import { beforeAll, describe, expect, it } from "vitest";

import {
  docSourceSlugFromFilename,
  preferMdxDocSourceFiles,
} from "../../lib/docs-source";
import {
  DocBlock,
  DocBlocksProvider,
  resolveDocBlockType,
  splitDocSegments,
  validateDocBlock,
  validateDocSegment,
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

type DocSegment = ReturnType<typeof splitDocSegments>[number];
type BlockSegment = Extract<DocSegment, { kind: "block" }>;
type ValidatableBlockSegment =
  | BlockSegment
  | Extract<DocSegment, { kind: "invalid-block" }>;
type ParsedDoc = LoadedDoc & {
  segments: DocSegment[];
};

function loadDocsFromDir(dir: string, locale?: string): LoadedDoc[] {
  return preferMdxDocSourceFiles(readdirSync(dir)).map((name) => ({
    locale,
    slug: docSourceSlugFromFilename(name),
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

function parseJsonBlockData(segment: BlockSegment): unknown {
  if (segment.source === "mdx") return segment.data;
  if (resolveDocBlockType(segment.alias) === "mermaid") return undefined;
  const trimmed = segment.body.trim();
  if (!trimmed) return undefined;
  return JSON.parse(trimmed) as unknown;
}

function fileTreeSegments(doc: ParsedDoc) {
  return doc.segments.filter(
    (segment): segment is BlockSegment =>
      segment.kind === "block" &&
      (segment.source === "mdx"
        ? segment.type === "file-tree"
        : resolveDocBlockType(segment.alias) === "file-tree"),
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

function fileTreeTitle(segment: BlockSegment): unknown {
  return segment.source === "mdx" ? segment.title : segment.attrs.title;
}

function isValidatableBlockSegment(
  segment: DocSegment,
): segment is ValidatableBlockSegment {
  return segment.kind === "block" || segment.kind === "invalid-block";
}

function markdownLinesOutsideFences(markdown: string): string[] {
  const lines: string[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) lines.push(line);
  }
  return lines;
}

describe("docs visual blocks", () => {
  const docs = loadDocs();
  const localizedDocs = loadLocalizedDocs();
  let allDocs: ParsedDoc[] = [];
  let localizedParsedDocs: ParsedDoc[] = [];
  let docsBySlug = new Map<string, ParsedDoc>();

  beforeAll(() => {
    const parseDoc = (doc: LoadedDoc): ParsedDoc => ({
      ...doc,
      segments: splitDocSegments(doc.body),
    });
    const parsedDocs = docs.map(parseDoc);
    localizedParsedDocs = localizedDocs.map(parseDoc);
    allDocs = [...parsedDocs, ...localizedParsedDocs];
    docsBySlug = new Map(parsedDocs.map((doc) => [doc.slug, doc]));
  }, 90_000);

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
      const parsedFenceBlocks = doc.segments.filter(
        (segment) =>
          segment.kind === "block" &&
          segment.source === "fence" &&
          segment.alias.startsWith("an-"),
      ).length;
      if (parsedFenceBlocks !== rawOpeners) {
        failures.push(
          `${docLabel(doc)}: ${rawOpeners} \`an-*\` openers but ${parsedFenceBlocks} parsed fence blocks`,
        );
      }
    }
    expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
  }, 30_000);

  it("does not leave legacy an-* source fences in docs", () => {
    const failures = allDocs
      .map((doc) => {
        const count = (doc.body.match(/^```an-[\w-]+/gm) ?? []).length;
        return count > 0 ? `${docLabel(doc)}: ${count} legacy fences` : "";
      })
      .filter(Boolean);

    expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
  }, 30_000);

  it("does not leave registered MDX block tags behind as prose", () => {
    const failures: string[] = [];
    const rawBlockTagPattern =
      /^\s*<(?:AnnotatedCode|Callout|Checklist|Columns|DataModel|Diagram|Diff|Endpoint|FileTree|JsonExplorer|OpenApiSpec|Table|Tabs|Wireframe)(?:\s|>|\/|$)/;
    for (const doc of allDocs) {
      const leaked = doc.segments
        .filter((segment) => segment.kind === "markdown")
        .flatMap((segment) =>
          markdownLinesOutsideFences(segment.text).filter((line) =>
            rawBlockTagPattern.test(line),
          ),
        );
      if (leaked.length > 0) {
        failures.push(
          `${docLabel(doc)}: unparsed registered MDX block tags: ${leaked.join(
            ", ",
          )}`,
        );
      }
    }
    expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
  }, 30_000);

  it("every embedded block passes its schema", () => {
    const failures: string[] = [];
    for (const doc of allDocs) {
      doc.segments.forEach((segment, index) => {
        if (!isValidatableBlockSegment(segment)) return;
        const result = validateDocSegment(segment);
        if (!result.ok) {
          failures.push(
            `${docLabel(doc)} [block #${index} \`${
              segment.kind === "invalid-block"
                ? segment.tag
                : segment.source === "mdx"
                  ? segment.type
                  : segment.alias
            }\`]: ${result.error}`,
          );
        }
      });
    }
    expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
  }, 30_000);

  it("every embedded block renders through the SSR path", () => {
    const failures: string[] = [];
    for (const doc of allDocs) {
      doc.segments.forEach((segment, index) => {
        if (!isValidatableBlockSegment(segment)) return;
        try {
          const html = renderToStaticMarkup(
            <DocBlocksProvider>
              <DocBlock segment={segment} />
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
            `${docLabel(doc)} [block #${index} \`${
              segment.kind === "invalid-block"
                ? segment.tag
                : segment.source === "mdx"
                  ? segment.type
                  : segment.alias
            }\`]: render threw — ${(error as Error).message}`,
          );
        }
      });
    }
    expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
  }, 90_000);

  it("renders stable fallback ids across repeated SSR renders", () => {
    const element = (
      <DocBlocksProvider>
        <DocBlock
          segment={{
            kind: "block",
            source: "fence",
            alias: "an-callout",
            attrs: {},
            body: '{ "tone": "info", "body": "Stable id" }',
          }}
        />
      </DocBlocksProvider>
    );

    expect(renderToStaticMarkup(element)).toBe(renderToStaticMarkup(element));
  });

  it("fails registered MDX tags with unknown attributes", () => {
    const segment = splitDocSegments(
      `<Callout tone="info" typo="nope">\n\nHeads up.\n\n</Callout>`,
    ).find(isValidatableBlockSegment);

    expect(segment).toMatchObject({
      kind: "invalid-block",
      tag: "Callout",
    });
    expect(segment && validateDocSegment(segment)).toEqual({
      ok: false,
      error: "unknown attribute — typo",
    });
  });

  it("accepts the diagram frame attribute", () => {
    const segment = splitDocSegments(
      [
        '<Diagram frame="hide">',
        "",
        "```html",
        '<div class="diagram-node">A</div>',
        "```",
        "",
        "</Diagram>",
      ].join("\n"),
    ).find(isValidatableBlockSegment);

    expect(segment).toMatchObject({
      kind: "block",
      type: "diagram",
    });
    expect(segment && validateDocSegment(segment)).toEqual({ ok: true });
  });

  it("fails registered MDX tags with unknown nested data keys", () => {
    const segment = splitDocSegments(
      '<FileTree title="Files" entries={[{ path: "app/page.tsx", surprise: true }]} />',
    ).find(isValidatableBlockSegment);

    expect(segment).toMatchObject({
      kind: "invalid-block",
      tag: "FileTree",
    });
    expect(segment && validateDocSegment(segment)).toEqual({
      ok: false,
      error: "unknown key — entries[0].surprise",
    });
  });

  it("fails fenced block JSON with unknown data keys", () => {
    expect(
      validateDocBlock(
        "an-file-tree",
        JSON.stringify({
          title: "Files",
          entries: [{ path: "app/page.tsx", surprise: true }],
          extra: true,
        }),
      ),
    ).toEqual({
      ok: false,
      error: "unknown keys — extra, entries[0].surprise",
    });
  });

  it("localizes file-tree prose while preserving paths", () => {
    const failures: string[] = [];
    for (const localizedDoc of localizedParsedDocs) {
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
          shouldTranslateFileTreeText(fileTreeTitle(sourceTree)) &&
          fileTreeTitle(localizedTree) === fileTreeTitle(sourceTree)
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
  }, 30_000);
});
