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

  it("shows the static ribbon fallback when WebGL2 is unavailable", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    // oracle-change: the homepage hero no longer mounts the Toolkit wave; it draws the WebGL2 ribbon, so the wave-mount and WebGPU-probe assertions no longer apply.
    const { container } = render(<HeroBackground />);

    const ribbon = container.querySelector(
      '[data-agent-native-node-id="hero-ribbon"]',
    );
    expect(ribbon?.className).toContain("absolute");
    expect(ribbon?.className).toContain("inset-0");
    expect(ribbon?.getAttribute("data-ribbon-state")).toBe("fallback");
    expect(
      container.querySelector(
        '[data-agent-native-node-id="hero-ribbon-fallback"]',
      ),
    ).not.toBeNull();
  });
});
