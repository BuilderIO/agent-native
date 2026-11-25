import sharp from "sharp";
import { describe, expect, it } from "vitest";

import * as ingestion from "./index.js";
import {
  resolveBreakpoint,
  runMatchedCheck,
  summarizeResults,
  type ClockStrategy,
  type SideCapture,
  type SideCaptureRequest,
} from "./matched-capture.js";

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}

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
    const r = must(report.results[0]);
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
    const ok = must((await run("#ffffff")).results[0]);
    expect(ok.validity).toBe("valid");
    expect(ok.fidelity?.rmsePercent).toBe(0);
    expect(ok.alphaNormalization?.sourceHadAlpha).toBe(true);
    const missing = must((await run(undefined)).results[0]);
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
    const ids = must(report.results[0])
      .checks.filter((c) => c.status === "fail")
      .map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "dpr-source",
        "bounds-destination",
        "clock-destination",
        "clock-match",
      ]),
    );
    expect(must(report.results[0]).fidelity).toBeUndefined();
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
      const r = must((await run(clock)).results[0]);
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
    expect(must(report.results[0]).diagnostics.join()).toContain(
      "reduced-motion-source",
    );
    expect(must(report.results[0]).validity).toBe("invalid");
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
    expect(must(desktop).validity).toBe("valid");
    expect(must(desktop).fidelity?.rmsePercent).toBe(0);
    expect(must(desktop).fidelity?.pass).toBeNull();
    expect(must(mobile).validity).toBe("could-not-run");
    expect(must(mobile).fidelity).toBeUndefined();
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
    const r = must(report.results[0]);
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

  it("exports the matched-check API from the ingestion index", () => {
    expect(ingestion.runMatchedCheck).toBe(runMatchedCheck);
    expect(ingestion.resolveBreakpoint).toBe(resolveBreakpoint);
    expect(ingestion.summarizeResults).toBe(summarizeResults);
    expect(ingestion.BREAKPOINT_PRESETS.desktop.width).toBe(1440);
    expect(typeof ingestion.createPlaywrightCapturer).toBe("function");
  });

  it("scores opaque captures without a background", async () => {
    const rgb = (v: number) =>
      sharp({
        create: {
          width: 8,
          height: 8,
          channels: 3,
          background: { r: v, g: v, b: v },
        },
      })
        .png()
        .toBuffer();
    const report = await runMatchedCheck({
      ...base,
      background: undefined,
      breakpoints: [{ name: "o", width: 8, height: 8, deviceScaleFactor: 1 }],
      capture: async (req) => ({
        ...(await good(req)),
        image: await rgb(req.side === "source" ? 0 : 255),
      }),
    });
    const r = must(report.results[0]);
    expect(r.validity).toBe("valid");
    expect(r.fidelity?.rmsePercent).toBe(100);
    expect(r.alphaNormalization?.background).toBe("none");
  });

  it("rejects a background that is not #rrggbb", async () => {
    const report = await runMatchedCheck({
      ...base,
      background: "white",
      breakpoints: [{ name: "o", width: 8, height: 8, deviceScaleFactor: 1 }],
      capture: (req) => good(req),
    });
    const r = must(report.results[0]);
    expect(r.validity).toBe("invalid");
    expect(r.fidelity).toBeUndefined();
    expect(r.diagnostics.join()).toContain("not an opaque #rrggbb");
  });

  it("counts a missed RMSE threshold as a failure", async () => {
    const report = await runMatchedCheck({
      ...base,
      maxRmsePercent: 1,
      breakpoints: [{ name: "s", width: 8, height: 8, deviceScaleFactor: 1 }],
      capture: (req) =>
        good(
          req,
          {},
          req.side === "source" ? [0, 0, 0, 255] : [255, 255, 255, 255],
        ),
    });
    expect(report.totals.fail).toBe(1);
    expect(report.totals.checks).toBe(must(report.results[0]).checks.length);
    expect(must(report.results[0]).diagnostics.join()).toContain(
      "exceeds threshold 1%",
    );
    const passing = await runMatchedCheck({
      ...base,
      maxRmsePercent: 1,
      breakpoints: [{ name: "s", width: 8, height: 8, deviceScaleFactor: 1 }],
      capture: (req) => good(req),
    });
    expect(passing.totals.fail).toBe(0);
    expect(must(passing.results[0]).fidelity?.pass).toBe(true);
  });

  it("rejects malformed motion and capturers that change the requested clock", async () => {
    await expect(
      runMatchedCheck({
        ...base,
        breakpoints: [{ name: "s", width: 8, height: 8, deviceScaleFactor: 1 }],
        motion: { frames: NaN, intervalMs: 1 },
        capture: (req) => good(req),
      }),
    ).rejects.toThrow("motion requires");
    const report = await runMatchedCheck({
      ...base,
      breakpoints: [{ name: "s", width: 8, height: 8, deviceScaleFactor: 1 }],
      capture: async (req) => {
        const captured = await good(req);
        captured.clock.requestedTimeMs = T + 100;
        captured.observed.timeMs = T + 100;
        return captured;
      },
    });
    expect(must(report.results[0]).diagnostics.join()).toContain(
      "did not honor the requested clock",
    );
  });

  it("rejects an empty breakpoint list", async () => {
    await expect(
      runMatchedCheck({
        ...base,
        breakpoints: [],
        capture: (req) => good(req),
      }),
    ).rejects.toThrow("at least one breakpoint");
  });

  it("rejects duplicate breakpoint names", async () => {
    await expect(
      runMatchedCheck({
        ...base,
        breakpoints: [{ preset: "mobile" }, { preset: "mobile" }],
        capture: (req) => good(req),
      }),
    ).rejects.toThrow('Duplicate breakpoint name "mobile"');
  });

  it("fails breakpoint names that are unsafe as filenames", async () => {
    const stored: string[] = [];
    const names = ["../escape", "a/b", "", ".hidden", "x".repeat(65)];
    const report = await runMatchedCheck({
      ...base,
      breakpoints: names.map((name) => ({
        name,
        width: 8,
        height: 8,
        deviceScaleFactor: 1,
      })),
      storeArtifact: (name) => {
        stored.push(name);
        return name;
      },
      capture: (req) => good(req),
    });
    expect(stored).toEqual([]);
    for (const r of report.results) {
      expect(r.validity).toBe("invalid");
      expect(r.diagnostics.join()).toContain("name must be");
    }
  });

  it("rejects invalid capture dimensions and crops before capturing", async () => {
    const valid = { name: "test", width: 8, height: 8, deviceScaleFactor: 1 };
    const cases = [
      { ...valid, width: 0 },
      { ...valid, height: 1.5 },
      { ...valid, deviceScaleFactor: 0 },
      { ...valid, crop: { left: -1, top: 0, width: 2, height: 2 } },
      { ...valid, crop: { left: 7, top: 0, width: 2, height: 2 } },
      { ...valid, crop: { left: 0, top: 7, width: 2, height: 2 } },
    ];
    for (const breakpoint of cases) {
      let captured = false;
      const report = await runMatchedCheck({
        ...base,
        breakpoints: [breakpoint],
        capture: async (req) => {
          captured = true;
          return good(req);
        },
      });
      expect(must(report.results[0]).validity).toBe("invalid");
      expect(must(report.results[0]).fidelity).toBeUndefined();
      expect(captured).toBe(false);
    }
  });

  it("waits for in-flight breakpoints before surfacing a failure", async () => {
    let finished = false;
    const run = runMatchedCheck({
      ...base,
      concurrency: 2,
      breakpoints: [{ preset: "desktop" }, { preset: "mobile" }],
      storeArtifact: async (name) => {
        if (name.startsWith("mobile")) throw new Error("store failed");
        for (let tick = 0; tick < 50; tick++) await Promise.resolve();
        finished = true;
        return name;
      },
      capture: (req) => good(req),
    });
    await expect(run).rejects.toThrow("store failed");
    expect(finished).toBe(true);
  });

  it("scores RGBA captures without a background when all alpha pixels are opaque", async () => {
    const report = await runMatchedCheck({
      ...base,
      background: undefined,
      breakpoints: [
        { name: "rgba", width: 8, height: 8, deviceScaleFactor: 1 },
      ],
      capture: (req) =>
        good(
          req,
          {},
          req.side === "source" ? [0, 0, 0, 255] : [255, 255, 255, 255],
        ),
    });
    const r = must(report.results[0]);
    expect(r.validity).toBe("valid");
    expect(r.fidelity?.rmsePercent).toBe(100);
    expect(r.alphaNormalization?.background).toBe("none");
  });

  it("rejects non-finite or negative clockToleranceMs, invalid concurrency, and case-colliding breakpoint names", async () => {
    for (const clockToleranceMs of [-1, Infinity, NaN]) {
      await expect(
        runMatchedCheck({
          ...base,
          clockToleranceMs,
          breakpoints: [{ preset: "desktop" }],
          capture: (req) => good(req),
        }),
      ).rejects.toThrow("clockToleranceMs");
    }
    for (const concurrency of [0, -1, 1.5, Infinity, NaN]) {
      await expect(
        runMatchedCheck({
          ...base,
          concurrency,
          breakpoints: [{ preset: "desktop" }],
          capture: (req) => good(req),
        }),
      ).rejects.toThrow("concurrency");
    }
    await expect(
      runMatchedCheck({
        ...base,
        breakpoints: [
          { name: "Desktop", width: 8, height: 8, deviceScaleFactor: 1 },
          { name: "desktop", width: 8, height: 8, deviceScaleFactor: 1 },
        ],
        capture: (req) => good(req),
      }),
    ).rejects.toThrow('Duplicate breakpoint name "desktop"');
  });
});
