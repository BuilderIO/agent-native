import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync(
  new URL("./theme-families.css", import.meta.url),
  "utf8",
);

describe("theme families", () => {
  it("provides a shared palette for the resolved light and dark modes", () => {
    expect(css).toContain(':root[data-theme-family="agent-native"]');
    expect(css).toContain('.dark[data-theme-family="agent-native"]');
    expect(css).toContain("--background: 0 0% 100%");
    expect(css).toContain("--background: 0 0% 13%");
    expect(css).not.toContain("prefers-color-scheme");
  });

  it("leaves Original apps without family-specific variable overrides", () => {
    expect(css).not.toContain('data-theme-family="original"');
  });

  it("keeps the selected family palette ahead of appearance presets", () => {
    expect(css).toContain(
      ':root[data-theme-family="agent-native"][data-appearance]',
    );
    expect(css).toContain(
      '.dark[data-theme-family="agent-native"][data-appearance]',
    );
    expect(css).toContain("--background: 0 0% 100%");
    expect(css).toContain("--background: 0 0% 13%");
  });

  it("loads the selected family font and shared radius and composer tokens", () => {
    expect(css).toContain('--font-sans: "Inter Variable", "Inter", sans-serif');
    expect(css).toContain(
      '--font-wordmark: "Geist Variable", "Geist", sans-serif',
    );
    expect(css).toContain("--radius: 0.5rem");
    expect(css).toContain("--radius-md: 0.5rem");
    expect(css).toContain("--radius-lg: 0.625rem");
    expect(css).toContain("--radius-xl: 0.75rem");
    expect(css).toContain("--agent-kit-composer-radius: 0.75rem");
    expect(css).toContain(
      "--agent-kit-composer-elevation: var(--shadow-composer)",
    );
    expect(css).toContain("0 8px 15px rgba(26, 26, 26, 0.06)");
  });

  it("uses the code dark-palette composer elevation in dark mode", () => {
    expect(css).toContain(
      '.dark[data-theme-family="agent-native"][data-appearance]',
    );
    expect(css).toContain(
      "--shadow-composer: 0 8px 30px hsl(var(--background) / 0.22)",
    );
  });

  it("limits each family block to custom properties", () => {
    const blocks = [
      ...css.matchAll(
        /([^{}]*data-theme-family="agent-native"[^{}]*)\{([^{}]*)\}/g,
      ),
    ];

    expect(blocks.length).toBeGreaterThan(0);
    for (const [, selectors, declarations] of blocks) {
      expect(selectors).toContain("data-theme-family=");
      const entries = declarations
        .split(";")
        .map((entry) => entry.trim())
        .filter(Boolean);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry).toMatch(/^--[\w-]+\s*:/);
      }
    }
  });
});
