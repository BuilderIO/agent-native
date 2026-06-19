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

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DocBlock,
  DocBlocksProvider,
  splitDocSegments,
  validateDocBlock,
} from "./docBlocks";

const CONTENT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../core/docs/content",
);

function loadDocs(): { slug: string; body: string }[] {
  return readdirSync(CONTENT_DIR)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => ({
      slug: name.replace(/\.md$/, ""),
      body: readFileSync(join(CONTENT_DIR, name), "utf8"),
    }));
}

describe("docs visual blocks", () => {
  const docs = loadDocs();

  it("loads doc sources", () => {
    expect(docs.length).toBeGreaterThan(0);
  });

  // Guard against the splitter SILENTLY skipping a visual fence (e.g. a regex that
  // rejects a valid info string), which would otherwise leak raw JSON into the
  // page AND bypass the schema/render checks below (they only see parsed blocks).
  it("parses every raw an-* fence opener into a block segment", () => {
    const failures: string[] = [];
    for (const doc of docs) {
      const rawOpeners = (doc.body.match(/^```an-[\w-]+/gm) ?? []).length;
      const parsedBlocks = splitDocSegments(doc.body).filter(
        (segment) => segment.kind === "block",
      ).length;
      if (parsedBlocks !== rawOpeners) {
        failures.push(
          `${doc.slug}: ${rawOpeners} \`an-*\` openers but ${parsedBlocks} parsed blocks`,
        );
      }
    }
    expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
  });

  it("every embedded block passes its schema", () => {
    const failures: string[] = [];
    for (const doc of docs) {
      const segments = splitDocSegments(doc.body);
      segments.forEach((segment, index) => {
        if (segment.kind !== "block") return;
        const result = validateDocBlock(segment.alias, segment.body);
        if (!result.ok) {
          failures.push(
            `${doc.slug} [block #${index} \`${segment.alias}\`]: ${result.error}`,
          );
        }
      });
    }
    expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
  });

  it("every embedded block renders through the SSR path", () => {
    const failures: string[] = [];
    for (const doc of docs) {
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
            failures.push(`${doc.slug} [block #${index}]: empty render`);
          }
        } catch (error) {
          failures.push(
            `${doc.slug} [block #${index} \`${segment.alias}\`]: render threw — ${
              (error as Error).message
            }`,
          );
        }
      });
    }
    expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
  });

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
});
