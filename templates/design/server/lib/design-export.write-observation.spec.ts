import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trySaveExportFile } from "./design-export.js";

// trySaveExportFile loads "fs" with a dynamic import, so the mocks below replace
// the disk calls for that import too. They are no-ops, so no export file lands
// in the worktree. Each attempt reports itself before its mkdir, even one that fails.
const mocks = vi.hoisted(() => ({
  noteExternalWrite: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  noteExternalWrite: mocks.noteExternalWrite,
}));

vi.mock("fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("fs")>()),
  mkdirSync: mocks.mkdirSync,
  writeFileSync: mocks.writeFileSync,
}));

type WriteSpy = { mock: { invocationCallOrder: number[] } };

/** The save reported itself with `channel`, and before the first `write` call. */
function expectReportedBefore(write: WriteSpy, channel: string) {
  expect(write.mock.invocationCallOrder.length).toBeGreaterThan(0);
  expect(mocks.noteExternalWrite).toHaveBeenCalledWith(channel);
  expect(
    Math.min(...mocks.noteExternalWrite.mock.invocationCallOrder),
  ).toBeLessThan(Math.min(...write.mock.invocationCallOrder));
}

const exportDir = path.join(
  process.cwd(),
  "node_modules",
  ".cache",
  "agent-native-design",
  "exports",
);

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.noteExternalWrite.mockClear();
  mocks.mkdirSync.mockReset();
  mocks.writeFileSync.mockReset();
});

describe("trySaveExportFile", () => {
  it("reports the server-side copy before creating its folder and writing the file", async () => {
    const result = await trySaveExportFile("deck.html", "<html></html>");

    expect(result).toEqual({ filePath: path.join(exportDir, "deck.html") });
    expect(mocks.mkdirSync).toHaveBeenCalledWith(exportDir, {
      recursive: true,
    });
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      path.join(exportDir, "deck.html"),
      "<html></html>",
    );
    expectReportedBefore(mocks.mkdirSync, "local-disk");
    expectReportedBefore(mocks.writeFileSync, "local-disk");
    expect(Math.min(...mocks.mkdirSync.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...mocks.writeFileSync.mock.invocationCallOrder),
    );
  });

  it("reports a failed save attempt, and still returns the download payload", async () => {
    mocks.mkdirSync.mockImplementationOnce(() => {
      throw new Error("EACCES");
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await trySaveExportFile("deck.html", "<html></html>");

    expect(result).toEqual({
      saveWarning:
        "Could not save a server-side copy, but the download payload was created.",
    });
    expectReportedBefore(mocks.mkdirSync, "local-disk");
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });
});
