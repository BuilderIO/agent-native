// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { HeroBackground } from "./hero-background";

beforeAll(() => {
  class Inert {
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal("ResizeObserver", Inert);
  vi.stubGlobal("IntersectionObserver", Inert);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("HeroBackground", () => {
  it("keeps the background inside the clipped homepage hero section", () => {
    const route = readFileSync(
      resolve(process.cwd(), "app/routes/_index.tsx"),
      "utf8",
    );
    const hero = readFileSync(
      resolve(process.cwd(), "app/components/website-redesign/hero.tsx"),
      "utf8",
    );

    expect(route).not.toContain("HeroBackground");
    expect(hero.match(/<HeroBackground \/>/g)).toHaveLength(1);
    expect(hero.indexOf("<HeroBackground />")).toBeLessThan(
      hero.indexOf("<GridInner"),
    );
  });

  // oracle-change: the hero no longer mounts the WebGPU wave, so the old
  // adapter-probe assertion has no subject; this checks the WebGL2 fallback.
  it("leaves the hero readable when the browser has no WebGL2", () => {
    const { container } = render(<HeroBackground />);

    const ribbon = container.querySelector<HTMLElement>("[data-ribbon]");
    expect(ribbon?.dataset.ribbon).toBe("unavailable");
    expect(ribbon?.getAttribute("aria-hidden")).toBe("true");
    expect(ribbon?.className).toContain("pointer-events-none");
    expect(ribbon?.className).toContain("z-[-1]");
    expect(ribbon?.className).not.toContain("fixed");
  });
});
