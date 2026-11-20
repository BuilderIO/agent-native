import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The app's own accents are a second palette next to the shadcn tokens, so dark needs
 * its own values for them: when `.dark` left them at their light values, the New form
 * button drew light ink on a light fill (1.47:1) and workspace names dark ink on the
 * dark page (1.63:1).
 */
const css = readFileSync(path.join(__dirname, "global.css"), "utf8");

/** The declarations of one top-level rule, keyed by the CSS variable they set. */
function ruleVariables(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} exists in global.css`).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  const close = css.indexOf("\n}", open);
  const body = css.slice(open + 1, close);
  const vars: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const match = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*(.+?);\s*$/i);
    if (match?.[1] && match[2]) vars[match[1]] = match[2].trim();
  }
  return vars;
}

const FORMS_TOKENS = [
  "--forms-ink-heading",
  "--forms-ink-strong",
  "--forms-ink-off",
  "--forms-ink-faint",
  "--forms-solid",
  "--forms-solid-text",
  "--forms-placeholder",
  "--forms-link",
  "--forms-badge",
  "--forms-badge-foreground",
  "--forms-code-bg",
  "--forms-code-text",
];

describe("the Forms palette", () => {
  it("sets every Forms accent for the light page", () => {
    const light = ruleVariables(":root");
    for (const token of FORMS_TOKENS) expect(light[token], token).toBeTruthy();
  });

  it("replaces every Forms accent on a dark page instead of inheriting the light ink", () => {
    const light = ruleVariables(":root");
    const dark = ruleVariables(".dark");
    for (const token of FORMS_TOKENS) {
      expect(dark[token], `${token} has a dark value`).toBeTruthy();
      expect(dark[token], `${token} differs between light and dark`).not.toBe(
        light[token],
      );
    }
  });
});
