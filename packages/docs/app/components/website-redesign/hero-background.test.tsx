// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HeroBackground } from "./hero-background";

const { oceanMount, shaderMount } = vi.hoisted(() => ({
  oceanMount: vi.fn(),
  shaderMount: vi.fn(),
}));

vi.mock("./hero-shader-background", () => ({
  HeroShaderBackground: () => {
    shaderMount();
    return <div data-testid="webgl-wave" />;
  },
}));

vi.mock("./ocean/hero-ocean-background", () => ({
  HeroOceanBackground: () => {
    oceanMount();
    return <div data-testid="ocean" />;
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "gpu", {
    configurable: true,
    value: undefined,
  });
  oceanMount.mockClear();
  shaderMount.mockClear();
});

describe("HeroBackground", () => {
  it("uses the WebGL wave without probing an available WebGPU adapter", () => {
    const requestAdapter = vi.fn(async () => ({ name: "adapter" }));
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter },
    });

    render(<HeroBackground />);

    expect(screen.getByTestId("webgl-wave")).toBeDefined();
    expect(requestAdapter).not.toHaveBeenCalled();
    expect(oceanMount).not.toHaveBeenCalled();
  });
});
