// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WaveBackground } from "./WaveBackground.js";

const { oceanMount, oceanReady, probeWebgpuSupport, webGlMount } = vi.hoisted(
  () => ({
    oceanMount: vi.fn(),
    oceanReady: { current: undefined as (() => void) | undefined },
    probeWebgpuSupport: vi.fn(),
    webGlMount: vi.fn(),
  }),
);

vi.mock("./WebGlWaveBackground.js", () => ({
  WebGlWaveBackground: () => {
    webGlMount();
    return <div data-agent-native-wave="true" data-testid="webgl-wave" />;
  },
}));

vi.mock("./ocean/hero-ocean-background.js", () => ({
  HeroOceanBackground: ({ onReady }: { onReady: () => void }) => {
    oceanMount();
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

  it("keeps the WebGL wave visible while checking WebGPU support", () => {
    probeWebgpuSupport.mockReturnValue(new Promise(() => {}));

    render(<WaveBackground className="fixed inset-0" />);

    expect(screen.getByTestId("webgl-wave")).toBeDefined();
    expect(webGlMount).toHaveBeenCalledOnce();
    expect(oceanMount).not.toHaveBeenCalled();
  });

  it("keeps the WebGL wave until the Calendar ocean draws its first frame", async () => {
    probeWebgpuSupport.mockResolvedValue("supported");

    render(<WaveBackground />);

    expect(screen.getByTestId("webgl-wave")).toBeDefined();
    await waitFor(() => expect(screen.getByTestId("ocean-wave")).toBeDefined());
    expect(screen.getByTestId("webgl-wave")).toBeDefined();
    expect(oceanMount).toHaveBeenCalledOnce();

    act(() => oceanReady.current?.());

    await waitFor(() => expect(screen.queryByTestId("webgl-wave")).toBeNull());
  });

  it.each(["unsupported", "probe-failed"] as const)(
    "keeps the WebGL wave when WebGPU is %s",
    async (support) => {
      probeWebgpuSupport.mockResolvedValue(support);

      render(<WaveBackground />);

      await waitFor(() =>
        expect(screen.getByTestId("webgl-wave")).toBeDefined(),
      );
      expect(oceanMount).not.toHaveBeenCalled();
    },
  );
});
