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

function emitFunction(
  root: string,
  name: string,
  appBytes: number,
  ffmpegBytes = 0,
  resvgBytes = 0,
): void {
  const fnDir = path.join(root, name);
  mkdirSync(fnDir, { recursive: true });
  writeFileSync(path.join(fnDir, "server.mjs"), Buffer.alloc(appBytes));
  if (ffmpegBytes > 0) {
    const ffmpegDir = path.join(fnDir, "node_modules", "ffmpeg-static");
    mkdirSync(ffmpegDir, { recursive: true });
    writeFileSync(path.join(ffmpegDir, "ffmpeg"), Buffer.alloc(ffmpegBytes));
  }
  if (resvgBytes > 0) {
    const resvgDir = path.join(
      fnDir,
      "node_modules",
      "@resvg",
      "resvg-js-linux-x64-gnu",
    );
    mkdirSync(resvgDir, { recursive: true });
    writeFileSync(
      path.join(resvgDir, "resvgjs.linux-x64-gnu.node"),
      Buffer.alloc(resvgBytes),
    );
  }
}

function runGuard(
  functionsDir: string,
  baselineFile: string,
  extra: string[] = [],
  site = "mediaapp",
) {
  const result = spawnSync(
    process.execPath,
    [GUARD, "--site", site, "--dir", functionsDir, ...extra],
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
  it("marks filtered module names omitted without logging those names", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");
    writeFileSync(baselineFile, JSON.stringify({ chat: { server: MB } }));
    const functionsDir = build(root, "functions");
    emitFunction(functionsDir, "server", 7 * MB);
    const libs = path.join(functionsDir, "server", "_libs");
    mkdirSync(libs);
    writeFileSync(path.join(libs, "PRIVATE+name.mjs"), "PRIVATE_CONTENT");
    const checked = runGuard(functionsDir, baselineFile, [], "chat");
    assert.equal(checked.status, 1);
    assert.match(checked.output, /"filteredEntriesOmitted":true/);
    assert.match(checked.output, /"truncated":true/);
    assert.doesNotMatch(checked.output, /PRIVATE/);
  });
  it("preserves size guidance when a generated directory is malformed", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");
    writeFileSync(baselineFile, JSON.stringify({ chat: { server: MB } }));
    const functionsDir = build(root, "functions");
    emitFunction(functionsDir, "server", 7 * MB);
    writeFileSync(
      path.join(functionsDir, "server", "_chunks"),
      "PRIVATE_BUILD_CONTENT",
    );
    const checked = runGuard(functionsDir, baselineFile, [], "chat");
    assert.equal(checked.status, 1);
    assert.match(checked.output, /chunk-inventory.*"failed":true/);
    assert.match(checked.output, /re-record with --update/);
    assert.doesNotMatch(checked.output, /PRIVATE_BUILD_CONTENT|Error: ENOTDIR/);
  });
  it("reports capped generated chunk byte inventory on Chat growth without bundle content", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");
    writeFileSync(baselineFile, JSON.stringify({ chat: { server: MB } }));
    const functionsDir = build(root, "functions");
    emitFunction(functionsDir, "server", 7 * MB);
    const chunks = path.join(functionsDir, "server", "_chunks");
    mkdirSync(chunks);
    for (let i = 0; i < 25; i++)
      writeFileSync(
        path.join(chunks, `chunk-${i}.mjs`),
        "PRIVATE_BUILD_CONTENT",
      );
    const checked = runGuard(functionsDir, baselineFile, [], "chat");
    assert.equal(checked.status, 1);
    assert.match(checked.output, /chunk-inventory/);
    assert.match(checked.output, /"reported":20/);
    assert.match(checked.output, /"truncated":true/);
    assert.doesNotMatch(checked.output, /PRIVATE_BUILD_CONTENT/);
    const healthy = runGuard(functionsDir, baselineFile, ["--update"], "chat");
    assert.equal(healthy.status, 0);
    assert.doesNotMatch(healthy.output, /chunk-inventory/);
    assert.doesNotMatch(
      runGuard(functionsDir, baselineFile, [], "chat").output,
      /chunk-inventory/,
    );
  });

  it("marks a generated chunk scan truncated without changing the size gate", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");
    writeFileSync(baselineFile, JSON.stringify({ chat: { server: MB } }));
    const functionsDir = build(root, "functions");
    emitFunction(functionsDir, "server", 7 * MB);
    const libs = path.join(functionsDir, "server", "_libs");
    mkdirSync(libs);
    mkdirSync(path.join(libs, "nested"));
    writeFileSync(
      path.join(libs, "nested", "module.mjs"),
      "PRIVATE_NESTED_CONTENT",
    );
    for (let i = 0; i < 513; i++)
      writeFileSync(path.join(libs, `lib-${i}.mjs`), "x");
    const checked = runGuard(functionsDir, baselineFile, [], "chat");
    assert.equal(checked.status, 1);
    assert.match(checked.output, /"scanned":512/);
    assert.match(checked.output, /"scannedBytes":512/);
    assert.match(checked.output, /"scanTruncated":true/);
    assert.match(checked.output, /"nestedEntriesOmitted":true/);
    assert.match(
      checked.output,
      /"selection":"largest-within-name-ordered-sample"/,
    );
    assert.doesNotMatch(checked.output, /PRIVATE_NESTED_CONTENT/);
  });
  it("counts a deploy-gated payload in the size it compares", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");

    const withoutPayload = build(root, "beta");
    emitFunction(withoutPayload, "server", 4 * MB);
    assert.equal(
      runGuard(withoutPayload, baselineFile, ["--update"]).status,
      0,
    );

    const withPayload = build(root, "production");
    emitFunction(withPayload, "server", 4 * MB, 76 * MB);

    const checked = runGuard(withPayload, baselineFile);
    assert.equal(checked.status, 1, checked.output);
    assert.match(checked.output, /function payload grew/);
  });

  it("excludes the platform-selected Resvg binary from the comparison", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");

    const withoutPayload = build(root, "beta");
    emitFunction(withoutPayload, "server", 4 * MB);
    assert.equal(
      runGuard(withoutPayload, baselineFile, ["--update"]).status,
      0,
    );

    const withPayload = build(root, "production");
    emitFunction(withPayload, "server", 4 * MB, 0, 4 * MB);

    const checked = runGuard(withPayload, baselineFile);
    assert.equal(checked.status, 0, checked.output);
    assert.match(checked.output, /resvg-js-linux-x64-gnu/);
    assert.match(checked.output, /excluded/);
    assert.doesNotMatch(checked.output, /function payload grew/);
  });

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

  it("warns when a function falls more than 3MB below its baseline", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");
    const before = build(root, "before");
    emitFunction(before, "server", 8 * MB);
    assert.equal(runGuard(before, baselineFile, ["--update"]).status, 0);

    const after_ = build(root, "after");
    emitFunction(after_, "server", 4 * MB);
    const checked = runGuard(after_, baselineFile);
    assert.equal(checked.status, 0, checked.output);
    assert.match(checked.output, /fell more than 3MB below baseline/);
    assert.match(checked.output, /warning only/);
  });
});
