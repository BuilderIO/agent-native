import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runMatchedCheck: vi.fn(),
  close: vi.fn(async () => {}),
}));

vi.mock("../ingestion/matched-capture.js", () => ({
  createPlaywrightCapturer: () => ({
    capture: vi.fn(),
    close: mocks.close,
  }),
  runMatchedCheck: mocks.runMatchedCheck,
}));

import { runMatchedCheckCommand } from "./matched-check.js";

function report(
  totals: { fail?: number; couldNotRun?: number },
  validity = "valid",
) {
  return {
    results: [{ breakpoint: "a", validity, checks: [] }],
    totals: {
      breakpoints: 1,
      checks: 1,
      pass: 1,
      fail: 0,
      couldNotRun: 0,
      ...totals,
    },
  };
}

describe("matched-check command", () => {
  let dir: string;
  let spec: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "matched-check-"));
    spec = path.join(dir, "spec.json");
    await fs.writeFile(spec, JSON.stringify({ breakpoints: [] }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.runMatchedCheck.mockReset();
    mocks.close.mockClear();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("prints usage and exits 1 without a spec", async () => {
    expect(await runMatchedCheckCommand([])).toBe(1);
  });

  it("exits 0 only for a clean valid report and always closes the browser", async () => {
    mocks.runMatchedCheck.mockResolvedValue(report({}));
    expect(await runMatchedCheckCommand([spec, "--out", dir])).toBe(0);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("exits 2 on failed, could-not-run, non-valid or empty reports", async () => {
    for (const r of [
      report({ fail: 1 }),
      report({ couldNotRun: 1 }),
      report({}, "unverified"),
      report({ breakpoints: 0 }),
    ]) {
      mocks.runMatchedCheck.mockResolvedValue(r);
      expect(await runMatchedCheckCommand([spec, "--out", dir])).toBe(2);
    }
  });

  it("stores artifacts inside the output directory only", async () => {
    mocks.runMatchedCheck.mockImplementation(async (input) => {
      const file = await input.storeArtifact(
        "a-source.png",
        new Uint8Array([1]),
      );
      expect(file).toBe(path.join(await fs.realpath(dir), "a-source.png"));
      await expect(
        input.storeArtifact("../escape.png", new Uint8Array([1])),
      ).rejects.toThrow("escapes the output directory");
      return report({});
    });
    expect(await runMatchedCheckCommand([spec, "--out", dir])).toBe(0);
    await expect(fs.stat(path.join(dir, "a-source.png"))).resolves.toBeTruthy();
  });

  it("closes the browser when the run throws", async () => {
    mocks.runMatchedCheck.mockRejectedValue(new Error("boom"));
    await expect(runMatchedCheckCommand([spec, "--out", dir])).rejects.toThrow(
      "boom",
    );
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("parses output options independently of the spec and rejects missing values", async () => {
    mocks.runMatchedCheck.mockResolvedValue(report({}));
    expect(await runMatchedCheckCommand(["--out", dir, spec])).toBe(0);
    expect(await runMatchedCheckCommand([`--out=${dir}`, spec])).toBe(0);
    await expect(runMatchedCheckCommand([spec, "--out"])).rejects.toThrow(
      "requires a directory",
    );
  });

  it("replaces an existing artifact symlink without following it", async () => {
    const outside = path.join(dir, "outside");
    await fs.writeFile(outside, "preserved");
    await fs.symlink(outside, path.join(dir, "a-source.png"));
    mocks.runMatchedCheck.mockImplementation(async (input) => {
      await input.storeArtifact("a-source.png", new Uint8Array([1]));
      return report({});
    });
    expect(await runMatchedCheckCommand([spec, "--out", dir])).toBe(0);
    expect(await fs.readFile(outside, "utf8")).toBe("preserved");
  });
});
