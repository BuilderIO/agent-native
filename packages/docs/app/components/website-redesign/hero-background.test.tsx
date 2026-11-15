// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HeroBackground } from "./hero-background";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

  it("keeps the hero usable when WebGL is unavailable", () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);
    const { container } = render(<HeroBackground />);
    const canvas = container.querySelector("canvas");
    expect(getContext).toHaveBeenCalledWith("webgl", {
      alpha: true,
      antialias: false,
    });
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");
    expect(canvas?.className).toContain("absolute");
    expect(canvas?.className).toContain("inset-0");
    expect(canvas?.className).toContain("pointer-events-none");
    expect(canvas?.className).not.toContain("fixed");
  });
});
