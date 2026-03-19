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

  it("returns error when FILE_SYNC_BACKEND is missing", async () => {
    vi.stubEnv("FILE_SYNC_ENABLED", "true");
    vi.stubEnv("FILE_SYNC_BACKEND", "");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await createFileSync({ contentRoot: "./data" });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.reason).toContain("FILE_SYNC_BACKEND");
    }
    warnSpy.mockRestore();
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
