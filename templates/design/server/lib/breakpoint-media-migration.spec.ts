import { describe, expect, it } from "vitest";

import { migrateBreakpointMediaBounds } from "./breakpoint-media-migration.js";

const exactRangeHtml = (body: string, marker = "hero::left::390-809") =>
  `<!doctype html><html><head><style data-agent-native-breakpoint-range="${marker}">${body}</style></head><body></body></html>`;

const widthMap = (entries: Array<[number, number | null]>) =>
  new Map<number, number | null>(entries);

describe("exact breakpoint-range migration", () => {
  it("only migrates real style elements, not style-looking script text", () => {
    const scriptTemplate =
      `<script>const template = '<style data-agent-native-breakpoint-range="hero::left::390-809">` +
      `@media (max-width: 809px) { .script-only { color: red; } }</style>';</script>`;
    const html = exactRangeHtml(
      "@media (max-width: 809px) { .real { left: 24px; } }",
    ).replace("<style", `${scriptTemplate}<style`);

    const migrated = migrateBreakpointMediaBounds(html, new Map([[809, 899]]), {
      widthMap: widthMap([[390, 390]]),
    });

    expect(migrated).not.toBeNull();
    expect(migrated).toContain(
      '<style data-agent-native-breakpoint-range="hero::left::390-899">',
    );
    expect(migrated).toContain(
      '<style data-agent-native-breakpoint-range="hero::left::390-809">@media (max-width: 809px) { .script-only',
    );
    expect(migrated).toContain("@media (max-width: 899px) { .real");
  });

  it.each([
    ["an unclosed block", "@media (max-width: 809px) { .real { left: 24px; }"],
    ["an unclosed comment", "@media (max-width: 809px) { /* keep this"],
  ])("refuses exact-range CSS with %s", (_description, body) => {
    const migrated = migrateBreakpointMediaBounds(
      exactRangeHtml(body),
      new Map([[809, 899]]),
      { widthMap: widthMap([[390, 390]]) },
    );

    expect(migrated).toBeNull();
  });

  it("updates both bounds in a generated exact-range rule", () => {
    const migrated = migrateBreakpointMediaBounds(
      exactRangeHtml(
        "@media (min-width: 390px) and (max-width: 809px) { .real { left: 24px; } }",
      ),
      new Map([[809, 899]]),
      { widthMap: widthMap([[390, 420]]) },
    );

    expect(migrated).toContain(
      '<style data-agent-native-breakpoint-range="hero::left::420-899">',
    );
    expect(migrated).toContain(
      "@media (min-width: 420px) and (max-width: 899px)",
    );
  });

  it("updates a legacy exact-range rule that has only max-width", () => {
    const migrated = migrateBreakpointMediaBounds(
      exactRangeHtml("@media (max-width: 809px) { .real { left: 24px; } }"),
      new Map([[809, 899]]),
      { widthMap: widthMap([[390, 390]]) },
    );

    expect(migrated).toContain(
      '<style data-agent-native-breakpoint-range="hero::left::390-899">',
    );
    expect(migrated).toContain(
      "@media (max-width: 899px) { .real { left: 24px; } }",
    );
    expect(migrated).not.toContain("min-width");
  });

  it("is idempotent when the same old-to-new maps are applied twice", () => {
    const original = exactRangeHtml(
      "@media (min-width: 390px) and (max-width: 809px) { .real { left: 24px; } }",
    );
    const boundMap = new Map([[809, 899]]);
    const options = { widthMap: widthMap([[390, 420]]) };
    const first = migrateBreakpointMediaBounds(original, boundMap, options);
    expect(first).not.toBeNull();

    const second = migrateBreakpointMediaBounds(first!, boundMap, options);
    expect(second).toBe(first);
  });
});
