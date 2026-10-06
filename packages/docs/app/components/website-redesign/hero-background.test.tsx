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
  it("stays outside the clipped homepage hero section", () => {
    const route = readFileSync(
      resolve(process.cwd(), "app/routes/_index.tsx"),
      "utf8",
    );
    const hero = readFileSync(
      resolve(process.cwd(), "app/components/website-redesign/hero.tsx"),
      "utf8",
    );

    expect(route.match(/<HeroBackground \/>/g)).toHaveLength(1);
    expect(route.indexOf("<HeroBackground />")).toBeLessThan(
      route.indexOf("<Hero />"),
    );
    expect(hero).not.toContain("HeroBackground");
  });

  it("renders the shared Toolkit wave on the homepage", () => {
    const requestAdapter = vi.fn(async () => ({ name: "adapter" }));
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter },
    });

    render(<HeroBackground />);

    const wave = screen.getByTestId("shared-wave");
    expect(wave.className).toContain("h-full");
    expect(wave.parentElement?.className).toContain("fixed");
    expect(wave.parentElement?.className).toContain("inset-0");
    expect(wave.parentElement?.className).toContain("z-0");
    expect(requestAdapter).not.toHaveBeenCalled();
    expect(waveMount).toHaveBeenCalledOnce();
  });
});
