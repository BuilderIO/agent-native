import { describe, expect, it } from "vitest";

import { cliSpawnOptions } from "./process.js";

describe("cli process launch options", () => {
  it("allows real Windows executable paths to bypass cmd.exe", () => {
    expect(cliSpawnOptions({ shell: false }, "win32").shell).toBe(false);
  });

  it("keeps Windows shell support for command-name shims", () => {
    expect(cliSpawnOptions({}, "win32").shell).toBe(true);
  });

  it("does not enable a shell on Unix", () => {
    expect(cliSpawnOptions({}, "darwin").shell).toBe(false);
  });
});
