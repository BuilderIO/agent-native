// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HeroBackground } from "./hero-background";

const { oceanMount, shaderMount } = vi.hoisted(() => ({
  oceanMount: vi.fn(),
  shaderMount: vi.fn(),
}));

vi.mock("./hero-shader-background", () => ({
  HeroShaderBackground: () => {
    shaderMount();
    return <div data-testid="halftone" />;
  },
}));

vi.mock("./ocean/hero-ocean-background", () => ({
  HeroOceanBackground: (props: { onError: (error: unknown) => void }) => {
    oceanMount(props);
    return <div data-testid="ocean" />;
  },
}));

function stubReducedMotion(matches: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => query),
  );
  window.matchMedia = vi.fn(() => query) as never;
  return {
    fire(next: boolean) {
      query.matches = next;
      for (const cb of listeners) cb();
    },
  };
}

function stubGpu(requestAdapter: () => Promise<unknown>) {
  Object.defineProperty(navigator, "gpu", {
    configurable: true,
    value: { requestAdapter },
  });
}

function removeGpu() {
  Object.defineProperty(navigator, "gpu", {
    configurable: true,
    value: undefined,
  });
}

beforeEach(() => {
  stubReducedMotion(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  removeGpu();
  oceanMount.mockClear();
  shaderMount.mockClear();
});

describe("HeroBackground", () => {
  it("renders the ocean when an adapter is available", async () => {
    stubGpu(async () => ({ name: "adapter" }));
    render(<HeroBackground />);
    expect(await screen.findByTestId("ocean")).toBeDefined();
  });

  it("never flashes the halftone before the ocean", async () => {
    stubGpu(async () => ({ name: "adapter" }));
    render(<HeroBackground />);

    // The halftone is the fallback, not a placeholder. Painting it for the
    // few hundred ms before the ocean arrives reads as a different background
    // flashing up and being swapped out.
    expect(screen.queryByTestId("halftone")).toBeNull();
    await screen.findByTestId("ocean");
    expect(screen.queryByTestId("halftone")).toBeNull();
  });

  it("renders the halftone fallback when WebGPU is absent", async () => {
    removeGpu();
    render(<HeroBackground />);
    await waitFor(() => expect(screen.getByTestId("halftone")).toBeDefined());
    expect(screen.queryByTestId("ocean")).toBeNull();
  });

  it("treats a null adapter as unsupported rather than as a device", async () => {
    stubGpu(async () => null);
    render(<HeroBackground />);
    await waitFor(() => expect(screen.getByTestId("halftone")).toBeDefined());
    expect(screen.queryByTestId("ocean")).toBeNull();
  });

  it("falls back when the adapter request rejects", async () => {
    stubGpu(async () => {
      throw new Error("adapter exploded");
    });
    render(<HeroBackground />);
    await waitFor(() => expect(screen.getByTestId("halftone")).toBeDefined());
    expect(screen.queryByTestId("ocean")).toBeNull();
  });

  it("renders no background at all while the probe is in flight", () => {
    stubGpu(() => new Promise(() => {}));
    render(<HeroBackground />);
    expect(screen.queryByTestId("halftone")).toBeNull();
    expect(screen.queryByTestId("ocean")).toBeNull();
  });

  it("skips the probe entirely under reduced motion", async () => {
    stubReducedMotion(true);
    const requestAdapter = vi.fn(async () => ({ name: "adapter" }));
    stubGpu(requestAdapter);
    render(<HeroBackground />);
    await waitFor(() => expect(screen.getByTestId("halftone")).toBeDefined());
    expect(requestAdapter).not.toHaveBeenCalled();
  });

  it("demotes to the fallback when reduced motion turns on mid-session", async () => {
    const motion = stubReducedMotion(false);
    stubGpu(async () => ({ name: "adapter" }));
    render(<HeroBackground />);
    await screen.findByTestId("ocean");

    motion.fire(true);
    await waitFor(() => expect(screen.getByTestId("halftone")).toBeDefined());
  });

  it("demotes to the fallback when the renderer fails after a good probe", async () => {
    stubGpu(async () => ({ name: "adapter" }));
    render(<HeroBackground />);
    await screen.findByTestId("ocean");

    const { onError } = oceanMount.mock.calls.at(-1)![0];
    onError(new Error("device lost"));
    await waitFor(() => expect(screen.getByTestId("halftone")).toBeDefined());
  });
});
