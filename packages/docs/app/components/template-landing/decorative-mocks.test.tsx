// @vitest-environment jsdom

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ClipsLibraryMock } from "./ClipsLibraryMock";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

const INTERACTIVE_AFFORDANCES = [
  { pattern: /:hover\b/, name: ":hover" },
  { pattern: /:active\b/, name: ":active" },
  { pattern: /:focus(-visible|-within)?\b/, name: ":focus" },
  { pattern: /cursor:\s*(pointer|grab|text)/, name: "an interactive cursor" },
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function artworkFiles(): string[] {
  return readdirSync(DIRECTORY)
    .filter((name) => name.endsWith(".tsx") && !name.includes(".test."))
    .filter((name) =>
      readFileSync(join(DIRECTORY, name), "utf8").includes('role="img"'),
    );
}

afterEach(cleanup);

describe("decorative landing-page mocks", () => {
  it("finds the artwork modules it is meant to guard", () => {
    const files = artworkFiles();
    expect(files).toContain("ClipsLibraryMock.tsx");
    expect(files.length).toBeGreaterThanOrEqual(9);
  });

  it.each(artworkFiles())("%s simulates no interactivity", (name) => {
    const source = stripComments(readFileSync(join(DIRECTORY, name), "utf8"));
    for (const { pattern, name: affordance } of INTERACTIVE_AFFORDANCES) {
      expect(
        pattern.test(source),
        `${name} declares ${affordance}; role="img" artwork must stay inert`,
      ).toBe(false);
    }
  });
});

describe("ClipsLibraryMock", () => {
  it("renders as an image rather than as controls", () => {
    const { container } = render(<ClipsLibraryMock label="Clips app" />);
    const root = container.querySelector(".clips-mock");

    expect(root).not.toBeNull();
    expect(root?.getAttribute("role")).toBe("img");
    expect(root?.getAttribute("aria-label")).toBe("Clips app");
    expect(
      root?.querySelectorAll(
        'button, a, input, select, textarea, [role="button"], [role="link"], [tabindex]',
      ),
    ).toHaveLength(0);
  });

  it("does not accept pointer input", () => {
    const { container } = render(<ClipsLibraryMock label="Clips app" />);
    const css = container.querySelector("style")?.textContent ?? "";

    expect(container.textContent).toContain("Start recording");
    expect(css).toMatch(/\.clips-mock \{[^}]*pointer-events: none/);
  });
});
