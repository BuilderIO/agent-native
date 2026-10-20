import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providers = vi.hoisted(() => [] as any[]);
const mockCanAuthorizeBuilderApiRequest = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/file-upload", () => ({
  listFileUploadProviders: () => providers,
}));

vi.mock("@agent-native/core/server", () => ({
  BUILDER_ASSETS_WRITE_SCOPE: "assets:write",
  canAuthorizeBuilderApiRequest: (...args: unknown[]) =>
    mockCanAuthorizeBuilderApiRequest(...args),
  runWithRequestContext: async (
    _context: unknown,
    fn: () => Promise<unknown>,
  ) => fn(),
}));

import {
  allowsSqlRecordingChunkScratch,
  hasRequestVideoStorage,
  requiresConfiguredVideoStorage,
  VideoStorageStatusUnavailableError,
} from "./video-storage";

describe("video storage policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    providers.length = 0;
  });

  beforeEach(() => {
    mockCanAuthorizeBuilderApiRequest.mockReset();
    mockCanAuthorizeBuilderApiRequest.mockResolvedValue(false);
  });

  it("allows SQL recording chunk scratch only for local PGlite mode", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "pglite:./data/pglite");
    expect(requiresConfiguredVideoStorage()).toBe(false);
    expect(allowsSqlRecordingChunkScratch()).toBe(true);

    vi.stubEnv("DATABASE_URL", "postgres://example.invalid/app");
    expect(requiresConfiguredVideoStorage()).toBe(true);
    expect(allowsSqlRecordingChunkScratch()).toBe(false);
  });

  it("disables SQL recording chunk scratch in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "pglite:./data/pglite");
    expect(requiresConfiguredVideoStorage()).toBe(true);
    expect(allowsSqlRecordingChunkScratch()).toBe(false);
  });

  it("reports missing storage only when every lookup succeeds", async () => {
    providers.push({
      id: "s3",
      isConfigured: () => false,
      isConfiguredForRequest: async () => false,
    });

    await expect(hasRequestVideoStorage()).resolves.toBe(false);
  });

  it("preserves provider lookup failures as unavailable", async () => {
    providers.push({
      id: "s3",
      isConfigured: () => false,
      isConfiguredForRequest: async () => {
        throw new Error("database unavailable");
      },
    });

    await expect(hasRequestVideoStorage()).rejects.toBeInstanceOf(
      VideoStorageStatusUnavailableError,
    );
  });

  it("uses another configured provider despite a failed provider lookup", async () => {
    providers.push(
      {
        id: "s3",
        isConfigured: () => false,
        isConfiguredForRequest: async () => {
          throw new Error("database unavailable");
        },
      },
      {
        id: "local",
        isConfigured: () => true,
      },
    );

    await expect(hasRequestVideoStorage()).resolves.toBe(true);
  });

  it("preserves Builder credential lookup failures as unavailable", async () => {
    mockCanAuthorizeBuilderApiRequest.mockRejectedValue(
      new Error("credential store unavailable"),
    );

    await expect(hasRequestVideoStorage()).rejects.toBeInstanceOf(
      VideoStorageStatusUnavailableError,
    );
  });
});
