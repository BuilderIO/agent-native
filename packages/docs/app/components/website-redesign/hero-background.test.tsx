// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HeroBackground } from "./hero-background";

const { waveMount } = vi.hoisted(() => ({ waveMount: vi.fn() }));

vi.mock("@agent-native/toolkit/app/shared", () => ({
  WaveBackground: ({ className }: { className?: string }) => {
    waveMount();
    return <div className={className} data-testid="shared-wave" />;
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "gpu", {
    configurable: true,
    value: undefined,
  });
  waveMount.mockClear();
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

  it("renders the shared Toolkit wave on the homepage", () => {
    const requestAdapter = vi.fn(async () => ({ name: "adapter" }));
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter },
    });

    render(<HeroBackground />);

    const wave = screen.getByTestId("shared-wave");
    expect(wave.className).toContain("absolute");
    expect(wave.className).toContain("inset-0");
    expect(wave.className).toContain("z-[-1]");
    expect(wave.className).not.toContain("fixed");
    expect(requestAdapter).not.toHaveBeenCalled();
    expect(waveMount).toHaveBeenCalledOnce();
  });
});
