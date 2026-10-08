import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/node", () => {
  throw Object.assign(new Error("Cannot find package '@sentry/node'"), {
    code: "ERR_MODULE_NOT_FOUND",
  });
});
vi.mock("./auth.js", () => ({ getSession: vi.fn() }));
vi.mock("./capture-error.js", () => ({
  registerErrorCaptureProvider: vi.fn(),
}));
vi.mock("./framework-request-handler.js", () => ({
  awaitBootstrap: vi.fn().mockResolvedValue(undefined),
  markDefaultPluginProvided: vi.fn(),
}));
vi.mock("./request-context.js", () => ({
  addRequestContextObserver: vi.fn(),
  getRequestContext: vi.fn(),
}));

describe("server/sentry-plugin", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("lets Nitro boot when configured Sentry is an absent optional peer", async () => {
    process.env.SENTRY_SERVER_DSN = "https://public@example/123";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { createSentryPlugin } = await import("./sentry-plugin.js");
    const plugin = createSentryPlugin();

    await expect(plugin({ hooks: { hook: vi.fn() } })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toContain("Server Sentry disabled");
    expect(error.mock.calls[0]?.[0]).toContain("pnpm add @sentry/node");
    const { isServerSentryEnabled } = await import("./sentry.js");
    expect(isServerSentryEnabled()).toBe(false);
  });
});
