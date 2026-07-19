import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { withFileLockSync } from "./atomic-json-file.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("local JSON file locks", () => {
  it("recovers a stale lock left by a dead process", () => {
    const filePath = useTempFilePath();
    const lockPath = `${filePath}.lock`;
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: -1,
        createdAt: Date.now() - 31_000,
        token: "dead-owner",
      }),
    );

    expect(withFileLockSync(filePath, () => "recovered")).toBe("recovered");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("does not remove a replacement lock it does not own", () => {
    const filePath = useTempFilePath();
    const lockPath = `${filePath}.lock`;
    const replacement = {
      pid: process.pid,
      createdAt: Date.now(),
      token: "replacement-owner",
    };

    withFileLockSync(filePath, () => {
      fs.writeFileSync(lockPath, JSON.stringify(replacement));
    });

    expect(JSON.parse(fs.readFileSync(lockPath, "utf-8"))).toEqual(replacement);
  });
});

function useTempFilePath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-json-file-"));
  tempRoots.push(root);
  return path.join(root, "store.json");
}
