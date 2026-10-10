import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  batch: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@agent-native/core/db", () => ({ closeDbExec: mocks.close }));
vi.mock("../server/lib/design-native-texture-backfill.js", () => ({
  backfillDesignNativeTextureObjectsBatch: mocks.batch,
}));

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  mocks.batch.mockReset();
  mocks.close.mockReset();
});

describe("native texture backfill entry", () => {
  it("is inert when imported by server discovery", async () => {
    const originalArgv = process.argv[1];
    process.argv[1] = "/not-this-script.ts";
    try {
      await import("./backfill-native-texture-objects.js");
      expect(mocks.batch).not.toHaveBeenCalled();
      expect(mocks.close).not.toHaveBeenCalled();
    } finally {
      process.argv[1] = originalArgv;
    }
  });

  it("runs bounded batches and closes only on explicit invocation", async () => {
    const originalArgv = process.argv[1];
    process.argv[1] = "/not-this-script.ts";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { runNativeTextureBackfill } =
        await import("./backfill-native-texture-objects.js");
      mocks.batch
        .mockResolvedValueOnce({ migrated: 100, complete: false })
        .mockResolvedValueOnce({ migrated: 3, complete: true });
      await runNativeTextureBackfill();
      expect(mocks.batch).toHaveBeenCalledTimes(2);
      expect(mocks.close).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        JSON.stringify({ status: "complete", migrated: 103 }),
      );
    } finally {
      process.argv[1] = originalArgv;
    }
  });

  it("runs when the script is the direct CLI entry", async () => {
    const originalArgv = process.argv[1];
    process.argv[1] = fileURLToPath(
      new URL("./backfill-native-texture-objects.ts", import.meta.url),
    );
    mocks.batch.mockResolvedValue({ migrated: 0, complete: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await import("./backfill-native-texture-objects.js");
      expect(mocks.batch).toHaveBeenCalledTimes(1);
      expect(mocks.close).toHaveBeenCalledTimes(1);
    } finally {
      process.argv[1] = originalArgv;
    }
  });
});
