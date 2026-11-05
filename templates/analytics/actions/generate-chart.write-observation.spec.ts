import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A chart write leaves the app's files on disk, so the action reports it to
// the framework before writing. The PNG path and the SVG fallback each write
// once, and each must report first.
const mocks = vi.hoisted(() => ({
  noteExternalWrite: vi.fn(),
  writeFileSync: vi.fn(),
  renderToBuffer: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  noteExternalWrite: mocks.noteExternalWrite,
}));

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  writeFileSync: mocks.writeFileSync,
}));

vi.mock("chartjs-node-canvas", () => ({
  ChartJSNodeCanvas: class {
    renderToBuffer(config: unknown) {
      return mocks.renderToBuffer(config);
    }
  },
}));

vi.mock("@agent-native/core/tracking", () => ({
  track: mocks.track,
}));

const { default: generateChart } = await import("./generate-chart.js");

const roots: string[] = [];

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** A temp media directory, which the action resolves through an env override. */
function mediaDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-analytics-chart-"));
  roots.push(root);
  vi.stubEnv("AGENT_NATIVE_MEDIA_DIR", root);
  return root;
}

function runChart() {
  return generateChart.run({
    title: "Signups",
    labels: JSON.stringify(["Jan", "Feb"]),
    data: JSON.stringify([1, 2]),
    type: "bar",
    filename: "signups",
  });
}

describe("generate-chart local-disk writes", () => {
  it("notes a local-disk write before the PNG is written", async () => {
    const dir = mediaDir();
    const png = Buffer.from("png");
    mocks.renderToBuffer.mockResolvedValue(png);

    const result = await runChart();

    expect(result).toMatchObject({ renderer: "png", filename: "signups.png" });
    expect(mocks.noteExternalWrite).toHaveBeenCalledWith("local-disk");
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      path.join(dir, "signups.png"),
      png,
    );
    expect(mocks.noteExternalWrite.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.writeFileSync.mock.invocationCallOrder[0],
    );
  });

  it("notes a local-disk write before the SVG fallback is written", async () => {
    const dir = mediaDir();
    mocks.renderToBuffer.mockRejectedValue(new Error("canvas unavailable"));

    const result = await runChart();

    expect(result).toMatchObject({
      renderer: "svg-fallback",
      filename: "signups.svg",
      fallbackReason: "canvas unavailable",
    });
    expect(mocks.noteExternalWrite).toHaveBeenCalledTimes(1);
    expect(mocks.noteExternalWrite).toHaveBeenCalledWith("local-disk");
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      path.join(dir, "signups.svg"),
      expect.stringContaining("<svg"),
      "utf8",
    );
    expect(mocks.noteExternalWrite.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.writeFileSync.mock.invocationCallOrder[0],
    );
  });

  it("notes nothing when the arguments are refused before any write", async () => {
    mediaDir();

    const result = await generateChart.run({
      title: "Signups",
      data: JSON.stringify([1, 2]),
    });

    expect(result).toMatchObject({
      error: "--labels is required (JSON array)",
    });
    expect(mocks.noteExternalWrite).not.toHaveBeenCalled();
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });
});
