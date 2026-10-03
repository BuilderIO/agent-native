import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../global.css", import.meta.url), "utf8");

describe("page body containment", () => {
  it("lets every block-fields track shrink below its widest line", () => {
    const source = readFileSync(
      new URL("./DocumentBlockFields.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      'const BLOCK_FIELDS_GRID = "grid grid-cols-[minmax(0,1fr)]"',
    );
    expect(source).not.toMatch(/className="grid(?:\s[^"]*)?"/);
  });

  it("wraps inline code without collapsing its spaces, while code blocks keep scrolling", () => {
    expect(css).not.toMatch(/\bpre,\s*code\s*\{[^}]*white-space:\s*pre;/);
    expect(css).toMatch(/\n\s*pre,\s*pre code\s*\{[^}]*white-space:\s*pre;/);
    expect(css).toMatch(/\n\s*code\s*\{[^}]*white-space:\s*pre-wrap;/);
    expect(css).toMatch(
      /\.notion-editor pre code\s*\{[^}]*white-space:\s*pre;/,
    );
  });

  it("lets list, task, and callout text tracks shrink", () => {
    expect(css).toMatch(
      /\.notion-editor ol > li\s*\{[^}]*grid-template-columns: minmax\(1rem, auto\) minmax\(0, 1fr\);/,
    );
    expect(css).toMatch(
      /\.notion-editor \.notion-task-list li\s*\{[^}]*grid-template-columns: 1rem minmax\(0, 1fr\);/,
    );
    expect(css).toMatch(
      /div\[data-notion-callout\]\s*\{[^}]*grid-template-columns: auto minmax\(0, 1fr\);/,
    );
  });

  it("enforces the readable table floor over Tiptap's inline min-width", () => {
    expect(css).toMatch(
      /\.notion-editor table\s*\{[^}]*min-width: var\(--content-table-min-width, 0px\) !important;/,
    );
  });

  it("sizes media minimums from the column, not the window", () => {
    for (const selector of [
      "\\.media-block__broken",
      "audio\\.media-block__content",
    ]) {
      const rule = css.match(new RegExp(`\\n${selector}\\s*\\{([^}]*)\\}`));
      expect(rule?.[1]).toBeDefined();
      expect(rule?.[1]).not.toMatch(/min-width:[^;]*100vw/);
    }
  });

  it("keeps media resize handles inside the narrowest page padding", () => {
    for (const side of ["left", "right"]) {
      const rule = css.match(
        new RegExp(`\\.media-block__resize-handle--${side}\\s*\\{([^}]*)\\}`),
      );
      const offset = rule?.[1].match(new RegExp(`${side}:\\s*-(\\d+)px`));
      expect(Number(offset?.[1])).toBeLessThanOrEqual(16);
    }
  });
});
