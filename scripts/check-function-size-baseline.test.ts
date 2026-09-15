import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const GUARD = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "check-function-size-baseline.mjs",
);

const workspaces: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "fn-size-baseline-"));
  workspaces.push(dir);
  return dir;
}

function build(root: string, name: string): string {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** An emitted function directory holding `appBytes` of app code, plus an
 *  optional bundled ffmpeg-static runtime of `ffmpegBytes`. */
function emitFunction(
  root: string,
  name: string,
  appBytes: number,
  ffmpegBytes = 0,
): void {
  const fnDir = path.join(root, name);
  mkdirSync(fnDir, { recursive: true });
  writeFileSync(path.join(fnDir, "server.mjs"), Buffer.alloc(appBytes));
  if (ffmpegBytes > 0) {
    const ffmpegDir = path.join(fnDir, "node_modules", "ffmpeg-static");
    mkdirSync(ffmpegDir, { recursive: true });
    writeFileSync(path.join(ffmpegDir, "ffmpeg"), Buffer.alloc(ffmpegBytes));
  }
}

function runGuard(
  functionsDir: string,
  baselineFile: string,
  extra: string[] = [],
) {
  const result = spawnSync(
    process.execPath,
    [GUARD, "--site", "mediaapp", "--dir", functionsDir, ...extra],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_NATIVE_FUNCTION_SIZE_BASELINE_FILE: baselineFile,
      },
    },
  );
  return { status: result.status, output: result.stdout + result.stderr };
}

const MB = 1024 * 1024;

after(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

describe("serverless function size baseline", () => {
  /**
   * The measurement stays raw on purpose. Subtracting the deploy-gated payload
   * while the committed baselines hold a mix of payload-inclusive and
   * payload-free numbers would let a real regression smaller than the payload
   * pass silently — the opposite of what this guard exists for.
   */
  it("counts a deploy-gated payload in the size it compares", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");

    const withoutPayload = build(root, "beta");
    emitFunction(withoutPayload, "server", 4 * MB);
    assert.equal(
      runGuard(withoutPayload, baselineFile, ["--update"]).status,
      0,
    );

    // Same app code, plus the production-only runtime payload.
    const withPayload = build(root, "production");
    emitFunction(withPayload, "server", 4 * MB, 76 * MB);

    const checked = runGuard(withPayload, baselineFile);
    assert.equal(checked.status, 1, checked.output);
    assert.match(checked.output, /function payload grew/);
  });

  /**
   * The part that cost two days: a 76MB swing with no visible cause. The
   * payload and its size have to be named at the moment the guard reports.
   */
  it("names the deploy-gated payload so the swing is not a mystery", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");

    const withPayload = build(root, "production");
    emitFunction(withPayload, "server", 4 * MB, 76 * MB);

    const checked = runGuard(withPayload, baselineFile, ["--update"]);
    assert.match(checked.output, /ffmpeg-static/);
    assert.match(checked.output, /AGENT_NATIVE_SERVERLESS_FFMPEG_ARCH/);
    assert.match(checked.output, /deploy-gated runtime payload/);
  });

  it("stays silent about payloads a build does not contain", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");

    const withoutPayload = build(root, "beta");
    emitFunction(withoutPayload, "server", 4 * MB);

    const checked = runGuard(withoutPayload, baselineFile, ["--update"]);
    assert.doesNotMatch(checked.output, /deploy-gated runtime payload/);
  });

  it("still fails when the app's own payload grows", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");

    const before = build(root, "before");
    emitFunction(before, "server", 4 * MB);
    assert.equal(runGuard(before, baselineFile, ["--update"]).status, 0);

    const after_ = build(root, "after");
    emitFunction(after_, "server", 12 * MB);

    const checked = runGuard(after_, baselineFile);
    assert.equal(checked.status, 1, checked.output);
    assert.match(checked.output, /function payload grew/);
  });
});
