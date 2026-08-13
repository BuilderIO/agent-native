import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertNativeDependencies,
  assertNodeRuntimeMarker,
  checkNativeDependencies,
  writeNodeRuntimeMarker,
} from "./native-dependencies.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("native dependency preflight", () => {
  it("loads better-sqlite3 from the current Node runtime", () => {
    expect(checkNativeDependencies().status).toBe("healthy");
    expect(assertNativeDependencies().status).toBe("healthy");
  });

  it("records the build ABI and rejects a different runtime ABI", () => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), "agent-native-native-runtime-"),
    );
    temporaryDirectories.push(directory);

    const markerPath = writeNodeRuntimeMarker(directory);
    expect(markerPath).toBeTruthy();
    expect(JSON.parse(readFileSync(markerPath!, "utf8"))).toMatchObject({
      nodeAbi: process.versions.modules,
      platform: process.platform,
      arch: process.arch,
    });

    const mismatchedMarker = JSON.parse(readFileSync(markerPath!, "utf8")) as {
      nodeAbi: string;
    };
    mismatchedMarker.nodeAbi = "different-node-abi";
    writeFileSync(markerPath!, `${JSON.stringify(mismatchedMarker)}\n`);

    expect(() => assertNodeRuntimeMarker(directory)).toThrow(
      /Production output was built for a different Node runtime/,
    );
  });
});
