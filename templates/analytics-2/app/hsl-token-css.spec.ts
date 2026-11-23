// @vitest-environment node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const APP_DIR = new URL(".", import.meta.url).pathname;
const GLOBAL_CSS = join(APP_DIR, "global.css");
const DATA_CSS = join(APP_DIR, "components/data/data.css");

function listCssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listCssFiles(full));
    else if (entry.endsWith(".css")) out.push(full);
  }
  return out.sort();
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, " "),
  );
}

function extractBareHslTokens(css: string): Set<string> {
  const tokens = new Set<string>();
  const cleaned = stripCssComments(css);
  const triplet =
    /(--[a-z0-9-]+)\s*:\s*\d+(?:\.\d+)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%\s*;/gi;
  for (const match of cleaned.matchAll(triplet)) {
    if (match[1]) tokens.add(match[1]);
  }
  return tokens;
}

function findUnwrappedBareHslUsages(
  file: string,
  css: string,
  bareHslTokens: ReadonlySet<string>,
): string[] {
  const cleaned = stripCssComments(css);
  const violations: string[] = [];
  const lines = cleaned.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("--")) continue;
    for (const match of line.matchAll(/var\(\s*(--[a-z0-9-]+)\b/g)) {
      const token = match[1];
      if (!token || !bareHslTokens.has(token)) continue;
      const before = line.slice(0, match.index);
      if (/\bhsla?\(\s*$/i.test(before)) continue;
      violations.push(`${file}:${i + 1}: ${trimmed}`);
    }
  }
  return violations;
}

describe("bare HSL CSS token wrapping and dialog width bounds", () => {
  it("wraps every bare-HSL custom property consumption in hsl()", () => {
    const bareHslTokens = extractBareHslTokens(
      readFileSync(GLOBAL_CSS, "utf8"),
    );
    expect(bareHslTokens.has("--muted-foreground")).toBe(true);
    expect(bareHslTokens.has("--border")).toBe(true);
    expect(bareHslTokens.has("--background")).toBe(true);
    expect(bareHslTokens.has("--card")).toBe(true);
    expect(bareHslTokens.has("--muted")).toBe(true);
    expect(bareHslTokens.has("--ring")).toBe(true);

    const violations: string[] = [];
    for (const file of listCssFiles(APP_DIR)) {
      const rel = relative(APP_DIR, file);
      violations.push(
        ...findUnwrappedBareHslUsages(
          rel,
          readFileSync(file, "utf8"),
          bareHslTokens,
        ),
      );
    }
    expect(violations).toEqual([]);
  });

  it("bounds .data-browser-dialog width within the viewport", () => {
    const css = stripCssComments(readFileSync(DATA_CSS, "utf8"));
    const blockMatch = /\.data-browser-dialog\s*\{([^}]*)\}/.exec(css);
    expect(blockMatch).not.toBeNull();
    const block = blockMatch?.[1] ?? "";
    expect(block).not.toMatch(/min-width\s*:\s*625px\s*;/);
    expect(block).toMatch(/min-width\s*:\s*min\(\s*625px\s*,/);
    expect(block).toMatch(/max-width\s*:\s*calc\(\s*100vw\s*-\s*32px\s*\)/);
  });
});
