// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShellSettledProvider } from "../../shell-ready";
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

// HeroBackground now waits for the root shell to stop remounting the page.
// These cases are about GPU probing, so they run with the shell settled.
function Settled({ children }: { children: React.ReactNode }) {
  return <ShellSettledProvider value>{children}</ShellSettledProvider>;
}

describe("HeroBackground", () => {
  it("renders the ocean when an adapter is available", async () => {
    stubGpu(async () => ({ name: "adapter" }));
    render(<Settled><HeroBackground /></Settled>);
    expect(await screen.findByTestId("ocean")).toBeDefined();
  });

  it("never flashes the halftone before the ocean", async () => {
    stubGpu(async () => ({ name: "adapter" }));
    render(<Settled><HeroBackground /></Settled>);

    // The halftone is the fallback, not a placeholder. Painting it for the
    // few hundred ms before the ocean arrives reads as a different background
    // flashing up and being swapped out.
    expect(screen.queryByTestId("halftone")).toBeNull();
    await screen.findByTestId("ocean");
    expect(screen.queryByTestId("halftone")).toBeNull();
  });

  it("renders the halftone fallback when WebGPU is absent", async () => {
    removeGpu();
    render(<Settled><HeroBackground /></Settled>);
    await waitFor(() => expect(screen.getByTestId("halftone")).toBeDefined());
    expect(screen.queryByTestId("ocean")).toBeNull();
  });

  it("treats a null adapter as unsupported rather than as a device", async () => {
    stubGpu(async () => null);
    render(<Settled><HeroBackground /></Settled>);
    await waitFor(() => expect(screen.getByTestId("halftone")).toBeDefined());
    expect(screen.queryByTestId("ocean")).toBeNull();
  });

  it("falls back when the adapter request rejects", async () => {
    stubGpu(async () => {
      throw new Error("adapter exploded");
    });
    render(<Settled><HeroBackground /></Settled>);
    await waitFor(() => expect(screen.getByTestId("halftone")).toBeDefined());
    expect(screen.queryByTestId("ocean")).toBeNull();
  });

  it("renders no background at all while the probe is in flight", () => {
    stubGpu(() => new Promise(() => {}));
    render(<Settled><HeroBackground /></Settled>);
    expect(screen.queryByTestId("halftone")).toBeNull();
    expect(screen.queryByTestId("ocean")).toBeNull();
  });

  it("skips the probe entirely under reduced motion", async () => {
    stubReducedMotion(true);
    const requestAdapter = vi.fn(async () => ({ name: "adapter" }));
    stubGpu(requestAdapter);
    render(<Settled><HeroBackground /></Settled>);
    await waitFor(() => expect(screen.getByTestId("halftone")).toBeDefined());
    expect(requestAdapter).not.toHaveBeenCalled();
  });

  it("demotes to the fallback when reduced motion turns on mid-session", async () => {
    const motion = stubReducedMotion(false);
    stubGpu(async () => ({ name: "adapter" }));
    render(<Settled><HeroBackground /></Settled>);
    await screen.findByTestId("ocean");

    motion.fire(true);
    await waitFor(() => expect(screen.getByTestId("halftone")).toBeDefined());
  });

  it("demotes to the fallback when the renderer fails after a good probe", async () => {
    stubGpu(async () => ({ name: "adapter" }));
    render(<Settled><HeroBackground /></Settled>);
    await screen.findByTestId("ocean");

    const { onError } = oceanMount.mock.calls.at(-1)![0];
    onError(new Error("device lost"));
    await waitFor(() => expect(screen.getByTestId("halftone")).toBeDefined());
  });
});

describe("HeroBackground shell gating", () => {
  it("does not probe for WebGPU until the root shell has settled", () => {
    const requestAdapter = vi.fn(async () => ({ name: "adapter" }));
    stubGpu(requestAdapter);

    render(
      <ShellSettledProvider value={false}>
        <HeroBackground />
      </ShellSettledProvider>,
    );

    // The shell remounts everything below it when the sidebar chunk resolves.
    // Probing before that builds the GPU graph, throws it away, and builds it
    // again -- the flash this gate exists to prevent.
    expect(requestAdapter).not.toHaveBeenCalled();
  });

  it("probes once the shell settles", async () => {
    const requestAdapter = vi.fn(async () => ({ name: "adapter" }));
    stubGpu(requestAdapter);

    const { rerender } = render(
      <ShellSettledProvider value={false}>
        <HeroBackground />
      </ShellSettledProvider>,
    );
    rerender(
      <ShellSettledProvider value>
        <HeroBackground />
      </ShellSettledProvider>,
    );

    await waitFor(() => expect(requestAdapter).toHaveBeenCalled());
  });
});
