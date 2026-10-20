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
  it("collects hashed assets from nested asset directories only", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-immutable-assets-"));
    const assetsDir = path.join(tempDir, "assets");
    fs.mkdirSync(path.join(assetsDir, "chunks", "nested"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(assetsDir, "app-aB12_cdE.js"), "");
    fs.writeFileSync(
      path.join(assetsDir, "chunks", "nested", "chunk-12345678.css"),
      "",
    );
    fs.writeFileSync(path.join(assetsDir, "plain.js"), "");
    fs.writeFileSync(
      path.join(assetsDir, "chunks", "nested", "malformed-1234567.js"),
      "",
    );

    expect(collectImmutableAssetPaths(tempDir)).toEqual([
      "/assets/app-aB12_cdE.js",
      "/assets/chunks/nested/chunk-12345678.css",
    ]);
    expect(
      isImmutableAssetPath("/assets/chunks/nested/chunk-12345678.css"),
    ).toBe(true);
    expect(isImmutableAssetPath("/assets/plain.js")).toBe(false);
  });
});
