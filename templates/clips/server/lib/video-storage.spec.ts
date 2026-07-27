import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/file-upload", () => ({
  listFileUploadProviders: () => [],
}));

vi.mock("@agent-native/core/server", () => ({
  resolveHasBuilderPrivateKey: async () => false,
  runWithRequestContext: async (
    _context: unknown,
    fn: () => Promise<unknown>,
  ) => fn(),
}));

import {
  allowsSqlRecordingChunkScratch,
  requiresConfiguredVideoStorage,
} from "./video-storage";

describe("video storage policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows SQL recording chunk scratch only for local database mode", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "file:./data/app.db");
    expect(requiresConfiguredVideoStorage()).toBe(false);
    expect(allowsSqlRecordingChunkScratch()).toBe(true);

    vi.stubEnv("DATABASE_URL", "postgres://example.invalid/app");
    expect(requiresConfiguredVideoStorage()).toBe(true);
    expect(allowsSqlRecordingChunkScratch()).toBe(false);
  });

  it("disables SQL recording chunk scratch in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "file:./data/app.db");
    expect(requiresConfiguredVideoStorage()).toBe(true);
    expect(allowsSqlRecordingChunkScratch()).toBe(false);
  });
});
