// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WaveBackground } from "./WaveBackground.js";

const { oceanError, oceanMount, oceanReady, probeWebgpuSupport } = vi.hoisted(
  () => ({
    oceanError: {
      current: undefined as ((error: unknown) => void) | undefined,
    },
    oceanMount: vi.fn(),
    oceanReady: { current: undefined as (() => void) | undefined },
    probeWebgpuSupport: vi.fn(),
  }),
);

vi.mock("./ocean/hero-ocean-background.js", () => ({
  HeroOceanBackground: ({
    onError,
    onReady,
  }: {
    onError: (error: unknown) => void;
    onReady: () => void;
  }) => {
    oceanMount();
    oceanError.current = onError;
    oceanReady.current = onReady;
    return <div data-agent-native-wave="true" data-testid="ocean-wave" />;
  },
}));

vi.mock("./ocean/webgpu-support.js", () => ({ probeWebgpuSupport }));

const repoRoot = resolve(process.cwd(), "../..");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  oceanError.current = undefined;
  oceanReady.current = undefined;
});

describe("WaveBackground", () => {
  it("keeps signup, homepage, and Calendar booking on the shared renderer", () => {
    const consumers = [
      resolve(repoRoot, "packages/toolkit/src/app/auth/AuthPage.tsx"),
      resolve(
        repoRoot,
        "packages/docs/app/components/website-redesign/hero-background.tsx",
      ),
      resolve(repoRoot, "templates/calendar/app/pages/BookingPage.tsx"),
    ];

    for (const path of consumers) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain("WaveBackground");
      expect(source, path).not.toMatch(
        /StarfieldBackground|HeroOceanBackground|HeroShaderBackground/,
      );
    }
  });

  it("renders no fallback in server HTML or while checking WebGPU support", () => {
    probeWebgpuSupport.mockReturnValue(new Promise(() => {}));

    expect(renderToString(createElement(WaveBackground))).toBe("");

    render(<WaveBackground className="fixed inset-0" />);

    expect(screen.queryByTestId("ocean-wave")).toBeNull();
    expect(oceanMount).not.toHaveBeenCalled();
  });

  it("shows only the Calendar ocean after support is confirmed", async () => {
    probeWebgpuSupport.mockResolvedValue("supported");

    render(<WaveBackground />);

    await waitFor(() => expect(screen.getByTestId("ocean-wave")).toBeDefined());
    expect(oceanMount).toHaveBeenCalledOnce();

    act(() => oceanReady.current?.());

    expect(screen.getByTestId("ocean-wave")).toBeDefined();
  });

  it("leaves the background empty when the ocean renderer fails", async () => {
    probeWebgpuSupport.mockResolvedValue("supported");

    render(<WaveBackground />);

    await waitFor(() => expect(screen.getByTestId("ocean-wave")).toBeDefined());
    act(() => oceanError.current?.(new Error("renderer failed")));

    expect(screen.queryByTestId("ocean-wave")).toBeNull();
  });

  it.each(["unsupported", "probe-failed"] as const)(
    "leaves the background empty when WebGPU is %s",
    async (support) => {
      probeWebgpuSupport.mockResolvedValue(support);

      render(<WaveBackground />);

      await waitFor(() => expect(probeWebgpuSupport).toHaveBeenCalledOnce());
      expect(screen.queryByTestId("ocean-wave")).toBeNull();
      expect(oceanMount).not.toHaveBeenCalled();
    },
  );
});
