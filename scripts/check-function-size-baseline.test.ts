import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

/** An emitted function directory holding `appBytes` of app code, plus an
 *  optional bundled ffmpeg-static runtime of `ffmpegBytes`. */
function emitFunction(
  root: string,
  name: string,
  appBytes: number,
  ffmpegBytes = 0,
): string {
  const fnDir = path.join(root, name);
  mkdirSync(fnDir, { recursive: true });
  writeFileSync(path.join(fnDir, "server.mjs"), Buffer.alloc(appBytes));
  if (ffmpegBytes > 0) {
    const ffmpegDir = path.join(fnDir, "node_modules", "ffmpeg-static");
    mkdirSync(ffmpegDir, { recursive: true });
    writeFileSync(path.join(ffmpegDir, "ffmpeg"), Buffer.alloc(ffmpegBytes));
  }
  return fnDir;
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
   * The regression this exists for. `ffmpeg-static` is bundled only when the
   * deploy environment sets AGENT_NATIVE_SERVERLESS_FFMPEG_ARCH, so production
   * emits it and beta does not. Measuring it made clips' production `server`
   * read 112.6MB against a 36.1MB baseline recorded on beta, and that phantom
   * 76MB blocked every production promotion of the media apps.
   */
  it("does not count a deploy-gated runtime payload as bundle growth", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");

    const betaBuild = path.join(root, "beta");
    mkdirSync(betaBuild, { recursive: true });
    emitFunction(betaBuild, "server", 4 * MB);
    const recorded = runGuard(betaBuild, baselineFile, ["--update"]);
    assert.equal(recorded.status, 0, recorded.output);

    // Same commit, production context: identical app code plus ffmpeg-static.
    const productionBuild = path.join(root, "production");
    mkdirSync(productionBuild, { recursive: true });
    emitFunction(productionBuild, "server", 4 * MB, 76 * MB);

    const checked = runGuard(productionBuild, baselineFile);
    assert.equal(checked.status, 0, checked.output);
    // Set aside, not silently dropped: the reviewer still sees the payload.
    assert.match(checked.output, /ffmpeg-static/);
    assert.match(checked.output, /no function grew past its baseline/);
  });

  it("still fails when the app's own payload grows", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");

    const before = path.join(root, "before");
    mkdirSync(before, { recursive: true });
    emitFunction(before, "server", 4 * MB);
    assert.equal(runGuard(before, baselineFile, ["--update"]).status, 0);

    // App code tripled; ffmpeg present too, so the exclusion must not mask it.
    const after_ = path.join(root, "after");
    mkdirSync(after_, { recursive: true });
    emitFunction(after_, "server", 12 * MB, 76 * MB);

    const checked = runGuard(after_, baselineFile);
    assert.equal(checked.status, 1, checked.output);
    assert.match(checked.output, /function payload grew/);
  });
});
