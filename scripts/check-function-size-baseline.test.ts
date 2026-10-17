import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

function chunkInventory(output: string) {
  const line = output
    .split(/\r?\n/)
    .find((item) => item.startsWith("[chunk-inventory] {"));
  assert.ok(line, output);
  return JSON.parse(line.slice("[chunk-inventory] ".length)) as {
    scanned: number;
    scannedBytes: number;
    reported: number;
    entriesScanned: number;
    maxEntries: number;
    maxDepth: number;
    entryLimitTruncated: boolean;
    depthTruncated: boolean;
    excludedEntries: number;
    excludedNonFileEntries: number;
    symlinkEntriesSkipped: number;
    symlinkDirectoriesSkipped: number;
    unsafePathsOmitted: boolean;
    truncated: boolean;
    scanComplete: boolean;
    directories: Array<{
      path: string;
      scannedFileCount: number;
      scannedFileBytes: number;
    }>;
  };
}

function chunkInventoryFiles(output: string) {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("[chunk-inventory] {"))
    .slice(1)
    .map(
      (line) =>
        JSON.parse(line.slice("[chunk-inventory] ".length)) as {
          path?: string | null;
          pathOmitted?: boolean;
          bytes: number;
        },
    );
}

const MB = 1024 * 1024;

after(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

describe("serverless function size baseline", () => {
  it("marks exact-cap scans complete including a final empty directory", () => {
    for (const emptyDirectory of [false, true]) {
      const root = workspace();
      const baselineFile = path.join(root, "baseline.json");
      writeFileSync(baselineFile, JSON.stringify({ chat: { server: MB } }));
      const functionsDir = build(root, "functions");
      emitFunction(functionsDir, "server", 7 * MB);
      const chunks = path.join(functionsDir, "server", "_chunks");
      mkdirSync(chunks);
      for (let i = 0; i < 4095 - Number(emptyDirectory); i++)
        writeFileSync(path.join(chunks, `module-${i}.mjs`), "x");
      if (emptyDirectory) mkdirSync(path.join(chunks, "empty"));
      const checked = runGuard(functionsDir, baselineFile, [], "chat");
      assert.equal(checked.status, 1);
      const inventory = chunkInventory(checked.output);
      assert.equal(inventory.entriesScanned, 4096);
      assert.equal(inventory.scanComplete, true);
      assert.equal(inventory.entryLimitTruncated, false);
    }
  });
  it("counts private filename metadata without disclosing non-module or hidden paths", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");
    writeFileSync(baselineFile, JSON.stringify({ chat: { server: MB } }));
    const functionsDir = build(root, "functions");
    emitFunction(functionsDir, "server", 7 * MB);
    const libs = path.join(functionsDir, "server", "_libs");
    mkdirSync(libs);
    writeFileSync(path.join(libs, "PRIVATE.json"), "123");
    writeFileSync(path.join(libs, ".PRIVATE.mjs"), "1234");
    const checked = runGuard(functionsDir, baselineFile, [], "chat");
    assert.equal(checked.status, 1);
    assert.equal(chunkInventory(checked.output).scannedBytes, 7);
    assert.doesNotMatch(checked.output, /PRIVATE/);
    assert.equal(
      chunkInventoryFiles(checked.output).every((file) => file.pathOmitted),
      true,
    );
  });
  it("reports safe scoped paths and omits unsafe path segments", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");
    writeFileSync(baselineFile, JSON.stringify({ chat: { server: MB } }));
    const functionsDir = build(root, "functions");
    emitFunction(functionsDir, "server", 7 * MB);
    const libs = path.join(functionsDir, "server", "_libs");
    const safeDir = path.join(libs, "@scope");
    const unsafeDir = path.join(libs, "unsafe segment");
    mkdirSync(safeDir, { recursive: true });
    mkdirSync(unsafeDir, { recursive: true });
    writeFileSync(path.join(safeDir, "visible+name.mjs"), "PRIVATE_CONTENT");
    writeFileSync(
      path.join(unsafeDir, "UNSAFE_PATH_SENTINEL.mjs"),
      "PRIVATE_CONTENT",
    );
    const checked = runGuard(functionsDir, baselineFile, [], "chat");
    assert.equal(checked.status, 1);
    assert.match(checked.output, /"unsafePathsOmitted":true/);
    assert.match(checked.output, /"truncated":true/);
    assert.match(checked.output, /_libs\/@scope\/visible\+name\.mjs/);
    assert.doesNotMatch(checked.output, /UNSAFE_PATH_SENTINEL|PRIVATE_CONTENT/);
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
  it("reports the largest 20 generated files without bundle content", () => {
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
    assert.equal(chunkInventory(checked.output).reported, 20);
    assert.equal(chunkInventory(checked.output).scanned, 25);
    assert.equal(chunkInventory(checked.output).scannedBytes, 25 * 21);
    assert.equal(chunkInventory(checked.output).truncated, true);
    assert.equal(chunkInventory(checked.output).scanComplete, true);
    assert.doesNotMatch(checked.output, /PRIVATE_BUILD_CONTENT/);
    const healthy = runGuard(functionsDir, baselineFile, ["--update"], "chat");
    assert.equal(healthy.status, 0);
    assert.doesNotMatch(healthy.output, /chunk-inventory/);
    assert.doesNotMatch(
      runGuard(functionsDir, baselineFile, [], "chat").output,
      /chunk-inventory/,
    );
  });

  it("aggregates nested generated files by root without reading bundle content", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");
    writeFileSync(baselineFile, JSON.stringify({ chat: { server: MB } }));
    const functionsDir = build(root, "functions");
    emitFunction(functionsDir, "server", 7 * MB);
    const libs = path.join(functionsDir, "server", "_libs");
    const chunks = path.join(functionsDir, "server", "_chunks");
    const nestedLib = path.join(libs, "@scope", "deep+package");
    const nestedChunk = path.join(chunks, "nested");
    mkdirSync(nestedLib, { recursive: true });
    mkdirSync(nestedChunk, { recursive: true });
    writeFileSync(path.join(nestedLib, "module.mjs"), Buffer.alloc(2048));
    writeFileSync(path.join(nestedLib, "asset.wasm"), Buffer.alloc(1024));
    writeFileSync(path.join(nestedChunk, "module.mjs"), Buffer.alloc(512));
    const checked = runGuard(functionsDir, baselineFile, [], "chat");
    assert.equal(checked.status, 1);
    const inventory = chunkInventory(checked.output);
    assert.equal(inventory.scanned, 3);
    assert.equal(inventory.scannedBytes, 3584);
    assert.deepEqual(inventory.directories, [
      { path: "_chunks", scannedFileCount: 1, scannedFileBytes: 512 },
      { path: "_libs", scannedFileCount: 2, scannedFileBytes: 3072 },
    ]);
    assert.match(checked.output, /_chunks\/nested\/module\.mjs/);
    assert.match(checked.output, /_libs\/@scope\/deep\+package\/module\.mjs/);
    assert.equal(inventory.scanComplete, true);
    assert.doesNotMatch(checked.output, /PRIVATE_NESTED_CONTENT/);
  });

  it("stops descending at the fixed directory depth and marks totals incomplete", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");
    writeFileSync(baselineFile, JSON.stringify({ chat: { server: MB } }));
    const functionsDir = build(root, "functions");
    emitFunction(functionsDir, "server", 7 * MB);
    const deepDirectory = path.join(
      functionsDir,
      "server",
      "_libs",
      ...Array.from({ length: 9 }, (_, index) => `level-${index + 1}`),
    );
    mkdirSync(deepDirectory, { recursive: true });
    writeFileSync(path.join(deepDirectory, "too-deep.mjs"), "x");

    const checked = runGuard(functionsDir, baselineFile, [], "chat");
    assert.equal(checked.status, 1);
    const inventory = chunkInventory(checked.output);
    assert.equal(inventory.maxDepth, 8);
    assert.equal(inventory.depthTruncated, true);
    assert.equal(inventory.scanned, 0);
    assert.equal(inventory.scanComplete, false);
    assert.doesNotMatch(checked.output, /too-deep\.mjs/);
  });

  it("selects a late-sorting large file from beyond the old 512-file sample", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");
    writeFileSync(baselineFile, JSON.stringify({ chat: { server: MB } }));
    const functionsDir = build(root, "functions");
    emitFunction(functionsDir, "server", 7 * MB);
    const chunks = path.join(functionsDir, "server", "_chunks");
    mkdirSync(chunks);
    for (let i = 0; i < 513; i++)
      writeFileSync(
        path.join(chunks, `chunk-${String(i).padStart(4, "0")}.mjs`),
        i === 512 ? Buffer.alloc(64 * 1024) : "x",
      );

    const checked = runGuard(functionsDir, baselineFile, [], "chat");
    assert.equal(checked.status, 1);
    const inventory = chunkInventory(checked.output);
    assert.equal(inventory.scanned, 513);
    assert.equal(inventory.scannedBytes, 512 + 64 * 1024);
    assert.equal(inventory.scanComplete, true);
    assert.equal(inventory.truncated, true);
    assert.ok(
      chunkInventoryFiles(checked.output).some(
        (file) => file.path === "_chunks/chunk-0512.mjs",
      ),
    );
  });

  it("caps the global entry scan and marks generated totals incomplete", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");
    writeFileSync(baselineFile, JSON.stringify({ chat: { server: MB } }));
    const functionsDir = build(root, "functions");
    emitFunction(functionsDir, "server", 7 * MB);
    const chunks = path.join(functionsDir, "server", "_chunks");
    const nested = path.join(chunks, "nested");
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, "nested.mjs"), "x");
    for (let i = 0; i < 4095; i++)
      writeFileSync(path.join(chunks, `chunk-${i}.mjs`), "x");
    const libs = path.join(functionsDir, "server", "_libs");
    mkdirSync(libs);
    writeFileSync(path.join(libs, "after-cap.mjs"), "x");

    const checked = runGuard(functionsDir, baselineFile, [], "chat");
    assert.equal(checked.status, 1);
    const inventory = chunkInventory(checked.output);
    assert.equal(inventory.entriesScanned, 4096);
    assert.equal(inventory.maxEntries, 4096);
    assert.equal(inventory.entryLimitTruncated, true);
    assert.equal(inventory.scanComplete, false);
    assert.equal(inventory.truncated, true);
    assert.ok(inventory.scanned <= 4096);
  });

  it("skips symlinked generated directories and files without following them", () => {
    const root = workspace();
    const baselineFile = path.join(root, "baseline.json");
    writeFileSync(baselineFile, JSON.stringify({ chat: { server: MB } }));
    const functionsDir = build(root, "functions");
    emitFunction(functionsDir, "server", 7 * MB);
    const outside = path.join(root, "outside");
    mkdirSync(outside);
    writeFileSync(path.join(outside, "SECRET_TARGET.mjs"), Buffer.alloc(8192));
    const serverDir = path.join(functionsDir, "server");
    symlinkSync(outside, path.join(serverDir, "_chunks"), "dir");
    const libs = path.join(serverDir, "_libs");
    mkdirSync(libs);
    symlinkSync(
      path.join(outside, "SECRET_TARGET.mjs"),
      path.join(libs, "linked.mjs"),
    );
    writeFileSync(path.join(libs, "safe.mjs"), "abc");

    const checked = runGuard(functionsDir, baselineFile, [], "chat");
    assert.equal(checked.status, 1);
    const inventory = chunkInventory(checked.output);
    assert.equal(inventory.scanned, 1);
    assert.equal(inventory.scannedBytes, 3);
    assert.equal(inventory.entriesScanned, 4);
    assert.equal(inventory.excludedEntries, 2);
    assert.equal(inventory.symlinkEntriesSkipped, 1);
    assert.equal(inventory.symlinkDirectoriesSkipped, 1);
    assert.equal(inventory.scanComplete, false);
    assert.doesNotMatch(checked.output, /SECRET_TARGET|8192/);
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
