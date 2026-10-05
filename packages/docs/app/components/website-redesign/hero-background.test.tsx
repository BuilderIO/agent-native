// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HeroBackground } from "./hero-background";

const { waveMount } = vi.hoisted(() => ({ waveMount: vi.fn() }));

vi.mock("@agent-native/toolkit/app/shared", () => ({
  WaveBackground: () => {
    waveMount();
    return <div data-testid="shared-wave" />;
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
  it("renders the shared Toolkit wave on the homepage", () => {
    const requestAdapter = vi.fn(async () => ({ name: "adapter" }));
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter },
    });

    render(<HeroBackground />);

    expect(screen.getByTestId("shared-wave")).toBeDefined();
    expect(requestAdapter).not.toHaveBeenCalled();
    expect(waveMount).toHaveBeenCalledOnce();
  });
});
