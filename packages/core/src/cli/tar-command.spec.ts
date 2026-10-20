import { describe, expect, it } from "vitest";

import { resolveTarExecutable } from "./tar-command.js";

describe("resolveTarExecutable", () => {
  it("uses tar from PATH outside Windows", () => {
    expect(resolveTarExecutable("linux")).toBe("tar");
  });

  it("uses Windows tar.exe by absolute path regardless of PATH order", () => {
    expect(resolveTarExecutable("win32", "C:\\Windows")).toBe(
      "C:\\Windows\\System32\\tar.exe",
    );
  });

  it("fails clearly when SystemRoot is unavailable on Windows", () => {
    expect(() => resolveTarExecutable("win32", "")).toThrow(
      "SystemRoot is required to resolve the Windows tar executable.",
    );
  });
});
