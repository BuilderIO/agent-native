import { afterEach, describe, expect, it, vi } from "vitest";

const OWNER = "owner@example.com";

describe("putStoredUpload (PGlite)", () => {
  afterEach(async () => {
    const { closeDbExec } = await import("@agent-native/core/db");
    await closeDbExec();
    Reflect.deleteProperty(globalThis as object, "__agentNativePgliteClients");
    Reflect.deleteProperty(
      globalThis as object,
      "__agentNativePgliteProcessLocks",
    );
    Reflect.deleteProperty(
      globalThis as object,
      "__agentNativePgliteProcessExitCleanupRegistered",
    );
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps every record when one owner's uploads finish together", async () => {
    vi.stubEnv("DATABASE_URL", "pglite:memory");
    const { getStoredUpload, putStoredUpload } =
      await import("./upload-store.js");
    const filenames = Array.from(
      { length: 8 },
      (_, index) => `upload-${index}.pdf`,
    );

    await Promise.all(
      filenames.map((filename) =>
        putStoredUpload(OWNER, {
          filename,
          originalName: filename,
          mimeType: "application/pdf",
          size: 1,
          url: `https://files.example.com/${filename}`,
          createdAt: 1,
        }),
      ),
    );

    for (const filename of filenames) {
      await expect(getStoredUpload(OWNER, filename)).resolves.toMatchObject({
        filename,
        url: `https://files.example.com/${filename}`,
      });
    }
  });
});
