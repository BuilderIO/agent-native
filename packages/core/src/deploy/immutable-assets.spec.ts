import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import {
  collectImmutableAssetPaths,
  isImmutableAssetPath,
} from "./immutable-assets.js";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("immutable assets", () => {
  it("recognizes both legacy and workspace content-hash lengths", () => {
    expect(isImmutableAssetPath("/assets/react-aB12_cdE.js")).toBe(true);
    expect(isImmutableAssetPath("/assets/react-aB12_cdE34567890.js")).toBe(
      true,
    );
    expect(isImmutableAssetPath("/assets/plain.js")).toBe(false);
    expect(isImmutableAssetPath("/assets/react-1234567.js")).toBe(false);
    expect(isImmutableAssetPath("/assets/react-123456789012345.js")).toBe(
      false,
    );
    expect(isImmutableAssetPath("/assets/react-12345678901234567.js")).toBe(
      false,
    );
  });

  it("collects hashed assets from nested asset directories only", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-immutable-assets-"));
    const assetsDir = path.join(tempDir, "assets");
    fs.mkdirSync(path.join(assetsDir, "chunks", "nested"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(assetsDir, "app-aB12_cdE.js"), "");
    fs.writeFileSync(path.join(assetsDir, "m-aB12_cdE2.js"), "");
    fs.writeFileSync(path.join(assetsDir, "m-aB12_cdE32.js"), "");
    fs.writeFileSync(path.join(assetsDir, "m-aB12_cdEx.js"), "");
    fs.writeFileSync(path.join(assetsDir, "backup-2026110917.pdf"), "");
    fs.writeFileSync(path.join(assetsDir, "script-2026110917.js"), "");
    fs.writeFileSync(path.join(assetsDir, "m-aB12_cdE2.css"), "");
    fs.writeFileSync(
      path.join(assetsDir, "chunks", "nested", "chunk-12345678.css"),
      "",
    );
    fs.writeFileSync(path.join(assetsDir, "workspace-aB12_cdE34567890.js"), "");
    fs.writeFileSync(path.join(assetsDir, "plain.js"), "");
    fs.writeFileSync(
      path.join(assetsDir, "chunks", "nested", "malformed-1234567.js"),
      "",
    );

    expect(collectImmutableAssetPaths(tempDir)).toEqual([
      "/assets/app-aB12_cdE.js",
      "/assets/chunks/nested/chunk-12345678.css",
      "/assets/m-aB12_cdE2.js",
      "/assets/m-aB12_cdE32.js",
      "/assets/workspace-aB12_cdE34567890.js",
    ]);
    expect(
      isImmutableAssetPath("/assets/chunks/nested/chunk-12345678.css"),
    ).toBe(true);
    expect(isImmutableAssetPath("/assets/plain.js")).toBe(false);
  });
});
