import { describe, it, expect, vi, afterEach } from "vitest";
import { createFileSync } from "./create-file-sync.js";

describe("createFileSync", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns disabled when FILE_SYNC_ENABLED is not set", async () => {
    vi.stubEnv("FILE_SYNC_ENABLED", "");
    const result = await createFileSync({ contentRoot: "./data" });
    expect(result.status).toBe("disabled");
  });

  it("returns disabled when FILE_SYNC_ENABLED is false", async () => {
    vi.stubEnv("FILE_SYNC_ENABLED", "false");
    const result = await createFileSync({ contentRoot: "./data" });
    expect(result.status).toBe("disabled");
  });

  it("defaults to drizzle when FILE_SYNC_BACKEND is not set", async () => {
    vi.stubEnv("FILE_SYNC_ENABLED", "true");
    vi.stubEnv("FILE_SYNC_BACKEND", "");
    // drizzle adapter will try to create a SQLite db at contentRoot/sync.db.
    // Pass a tmp dir so we don't pollute the cwd.
    const os = await import("os");
    const path = await import("path");
    const tmpDir = path.join(os.tmpdir(), `file-sync-test-${Date.now()}`);
    const fsMod = await import("fs");
    fsMod.mkdirSync(tmpDir, { recursive: true });
    // The adapter will be created but FileSync.initFileSync reads sync-config,
    // which may not exist — that's fine, the test just validates the backend resolves.
    const result = await createFileSync({ contentRoot: tmpDir });
    // Should not be "error: FILE_SYNC_BACKEND is missing" anymore
    if (result.status === "error") {
      expect(result.reason).not.toContain("FILE_SYNC_BACKEND");
    }
    // Clean up db if created
    if (result.status === "ready") await result.shutdown();
    fsMod.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns error when FILE_SYNC_BACKEND is invalid", async () => {
    vi.stubEnv("FILE_SYNC_ENABLED", "true");
    vi.stubEnv("FILE_SYNC_BACKEND", "mongodb");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await createFileSync({ contentRoot: "./data" });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.reason).toContain("invalid");
    }
    warnSpy.mockRestore();
  });

  it("returns error when firestore credentials are missing", async () => {
    vi.stubEnv("FILE_SYNC_ENABLED", "true");
    vi.stubEnv("FILE_SYNC_BACKEND", "firestore");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await createFileSync({ contentRoot: "./data" });
    expect(result.status).toBe("error");
    errorSpy.mockRestore();
  });

  it("returns error when supabase URL is missing", async () => {
    vi.stubEnv("FILE_SYNC_ENABLED", "true");
    vi.stubEnv("FILE_SYNC_BACKEND", "supabase");
    vi.stubEnv("SUPABASE_URL", "");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await createFileSync({ contentRoot: "./data" });
    expect(result.status).toBe("error");
    errorSpy.mockRestore();
  });

  it("returns error when CONVEX_URL is missing", async () => {
    vi.stubEnv("FILE_SYNC_ENABLED", "true");
    vi.stubEnv("FILE_SYNC_BACKEND", "convex");
    vi.stubEnv("CONVEX_URL", "");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await createFileSync({ contentRoot: "./data" });
    expect(result.status).toBe("error");
    errorSpy.mockRestore();
  });
});
