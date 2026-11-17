import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  resolveBreakpoint,
  runMatchedCheck,
  type ClockStrategy,
  type SideCapture,
  type SideCaptureRequest,
} from "./matched-capture.js";

const T = 1_700_000_000_000;
const pinned: ClockStrategy = { kind: "playwright-clock", timeMs: T };

async function png(
  w: number,
  h: number,
  rgba: [number, number, number, number],
): Promise<Uint8Array> {
  return sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: { r: rgba[0], g: rgba[1], b: rgba[2], alpha: rgba[3] / 255 },
    },
  })
    .png()
    .toBuffer();
}

async function good(
  req: SideCaptureRequest,
  overrides: Partial<SideCapture["observed"]> = {},
  rgba: [number, number, number, number] = [20, 40, 60, 255],
): Promise<SideCapture> {
  const bp = req.breakpoint;
  const w = Math.round((bp.crop?.width ?? bp.width) * bp.deviceScaleFactor);
  const h = Math.round((bp.crop?.height ?? bp.height) * bp.deviceScaleFactor);
  const timeMs = req.clock.kind === "unpinned" ? null : req.clock.timeMs;
  return {
    image: await png(w, h, rgba),
    observed: {
      viewport: { width: bp.width, height: bp.height },
      devicePixelRatio: bp.deviceScaleFactor,
      reducedMotion: bp.reducedMotion === "reduce",
      timeMs,
      ...overrides,
    },
    clock: {
      kind: req.clock.kind,
      requestedTimeMs: timeMs,
      pinned: req.clock.kind !== "unpinned",
    },
  };
}

const base = {
  source: { target: "a", clock: pinned },
  destination: { target: "b", clock: pinned },
  background: "#ffffff",
};

describe("matched capture", () => {
  it("rejects a requested-vs-observed viewport mismatch without a score", async () => {
    const report = await runMatchedCheck({
      ...base,
      breakpoints: [{ preset: "tablet" }],
      capture: (req) =>
        good(
          req,
          req.side === "source"
            ? { viewport: { width: 1440, height: 1200 } }
            : {},
        ),
    });
    const r = report.results[0]!;
    expect(r.validity).toBe("invalid");
    expect(r.fidelity).toBeUndefined();
    expect(r.diagnostics.join()).toContain(
      "requested 900x1200 but source rendered 1440x1200",
    );
  });

  it("normalizes alpha onto the declared background", async () => {
    const run = (background?: string) =>
      runMatchedCheck({
        ...base,
        background,
        breakpoints: [
          { name: "x", width: 10, height: 10, deviceScaleFactor: 1 },
        ],
        capture: (req) =>
          good(
            req,
            {},
            req.side === "source" ? [255, 255, 255, 0] : [255, 255, 255, 255],
          ),
      });
    const ok = (await run("#ffffff")).results[0]!;
    expect(ok.validity).toBe("valid");
    expect(ok.fidelity?.rmsePercent).toBe(0);
    expect(ok.alphaNormalization?.sourceHadAlpha).toBe(true);
    const missing = (await run(undefined)).results[0]!;
    expect(missing.validity).toBe("invalid");
    expect(missing.fidelity).toBeUndefined();
  });

  it("fails DPR, crop bounds and time incompatibility", async () => {
    const bp = {
      name: "c",
      width: 100,
      height: 100,
      deviceScaleFactor: 2,
      crop: { left: 0, top: 0, width: 50, height: 50 },
    };
    const report = await runMatchedCheck({
      ...base,
      breakpoints: [bp],
      capture: async (req) => {
        const c = await good(
          req,
          req.side === "source" ? { devicePixelRatio: 1 } : {},
        );
        if (req.side === "destination") {
          c.image = await png(50, 50, [1, 2, 3, 255]);
          c.observed.timeMs = T + 500;
        }
        return c;
      },
    });
    const ids = report.results[0]!.checks.filter(
      (c) => c.status === "fail",
    ).map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "dpr-source",
        "bounds-destination",
        "clock-destination",
        "clock-match",
      ]),
    );
    expect(report.results[0]!.fidelity).toBeUndefined();
  });

  it("labels unpinned and unsupported-hook clocks unverified", async () => {
    const run = (clock: ClockStrategy) =>
      runMatchedCheck({
        ...base,
        source: { target: "a", clock },
        breakpoints: [{ preset: "mobile" }],
        capture: async (req) => {
          const c = await good(req);
          if (req.side === "source" && req.clock.kind === "hook") {
            c.clock.pinned = false;
            c.clock.reason = "unsupported clock hook";
          }
          return c;
        },
      });
    for (const clock of [
      { kind: "unpinned" } as ClockStrategy,
      {
        kind: "hook",
        timeMs: T,
        setter: "nope",
        readback: "nope",
      } as ClockStrategy,
    ]) {
      const r = (await run(clock)).results[0]!;
      expect(r.validity).toBe("unverified");
      expect(r.fidelity).toBeUndefined();
      expect(r.checks.some((c) => c.status === "fail")).toBe(false);
    }
  });

  it("resolves presets and keeps overrides", () => {
    expect(resolveBreakpoint({ preset: "tablet" })).toMatchObject({
      width: 900,
      name: "tablet",
    });
    expect(
      resolveBreakpoint({ preset: "mobile", name: "m", deviceScaleFactor: 3 }),
    ).toMatchObject({
      width: 390,
      deviceScaleFactor: 3,
      name: "m",
    });
  });

  it("fails when reduced motion was requested but not observed", async () => {
    const report = await runMatchedCheck({
      ...base,
      breakpoints: [{ preset: "desktop", reducedMotion: "reduce" }],
      capture: (req) => good(req, { reducedMotion: false }),
    });
    expect(report.results[0]!.diagnostics.join()).toContain(
      "reduced-motion-source",
    );
    expect(report.results[0]!.validity).toBe("invalid");
  });

  it("isolates worker failures and totals equal entries", async () => {
    const report = await runMatchedCheck({
      ...base,
      concurrency: 2,
      breakpoints: [{ preset: "desktop" }, { preset: "mobile" }],
      capture: async (req) => {
        if (req.breakpoint.name === "mobile")
          throw new Error("browser crashed");
        return good(req);
      },
    });
    const [desktop, mobile] = report.results;
    expect(desktop!.validity).toBe("valid");
    expect(desktop!.fidelity?.rmsePercent).toBe(0);
    expect(desktop!.fidelity?.pass).toBeNull();
    expect(mobile!.validity).toBe("could-not-run");
    expect(mobile!.fidelity).toBeUndefined();
    const all = report.results.flatMap((r) => r.checks);
    const t = report.totals;
    expect(t.checks).toBe(all.length);
    expect(t.pass + t.fail + t.couldNotRun).toBe(all.length);
    expect(t.pass).toBe(all.filter((c) => c.status === "pass").length);
  });

  it("applies a caller threshold and stores artifacts", async () => {
    const report = await runMatchedCheck({
      ...base,
      maxRmsePercent: 1,
      breakpoints: [{ name: "s", width: 8, height: 8, deviceScaleFactor: 1 }],
      storeArtifact: (name) => `mem://${name}`,
      capture: (req) =>
        good(
          req,
          {},
          req.side === "source" ? [0, 0, 0, 255] : [255, 255, 255, 255],
        ),
    });
    const r = report.results[0]!;
    expect(r.fidelity).toMatchObject({
      rmsePercent: 100,
      pass: false,
      threshold: 1,
    });
    expect(r.artifacts.map((a) => a.handle)).toEqual([
      "mem://s-source.png",
      "mem://s-destination.png",
    ]);
  });
});
