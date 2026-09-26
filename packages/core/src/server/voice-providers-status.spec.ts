import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockResolveHasCompleteBuilderConnection = vi.fn();
const mockResolveSecret = vi.fn();
const mockPrefetchSecrets = vi.fn();
const mockGetOrgContext = vi.fn();
const mockResolveGoogleRealtimeCredentials = vi.fn();
const mockReadServiceProviderChoice = vi.fn();

let lastStatus = 200;

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getMethod: (event: any) => event._method ?? "GET",
  setResponseStatus: (_event: any, code: number) => {
    lastStatus = code;
  },
}));

vi.mock("./auth.js", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
}));

vi.mock("./credential-provider.js", () => ({
  prefetchSecrets: (...args: any[]) => mockPrefetchSecrets(...args),
  resolveHasCompleteBuilderConnection: (...args: any[]) =>
    mockResolveHasCompleteBuilderConnection(...args),
  resolveSecret: (...args: any[]) => mockResolveSecret(...args),
  // The Gemini key resolves through the alias resolver, which reads each name
  // in detail. Same answers as `resolveSecret`, so one mock drives both.
  resolveSecretDetailed: async (key: string) => {
    const value = await mockResolveSecret(key);
    return value
      ? { value, lookupFailed: false, source: "user", scopeId: "qa" }
      : { value: null, lookupFailed: false };
  },
  assertCredentialStoreReadable: () => {},
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: (...args: any[]) => mockGetOrgContext(...args),
}));

vi.mock("./request-context.js", () => ({
  runWithRequestContext: (_ctx: any, fn: () => unknown) => fn(),
}));

vi.mock("./google-realtime-session.js", () => ({
  resolveGoogleRealtimeCredentials: (...args: any[]) =>
    mockResolveGoogleRealtimeCredentials(...args),
}));

vi.mock("./service-providers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./service-providers.js")>()),
  readServiceProviderChoice: (...args: any[]) =>
    mockReadServiceProviderChoice(...args),
}));

import { createVoiceProvidersStatusHandler } from "./voice-providers-status.js";

function event(method = "GET") {
  return { _method: method };
}

describe("voice providers status route", () => {
  const originalGoogleCredsEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  beforeEach(() => {
    vi.clearAllMocks();
    lastStatus = 200;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    mockGetSession.mockResolvedValue({ email: "voice+qa@example.com" });
    mockResolveSecret.mockResolvedValue(null);
    mockPrefetchSecrets.mockResolvedValue(undefined);
    mockResolveHasCompleteBuilderConnection.mockResolvedValue(false);
    mockGetOrgContext.mockResolvedValue({ orgId: "org-123" });
    mockResolveGoogleRealtimeCredentials.mockResolvedValue(null);
    mockReadServiceProviderChoice.mockResolvedValue(null);
  });

  afterEach(() => {
    if (originalGoogleCredsEnv === undefined) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    } else {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = originalGoogleCredsEnv;
    }
  });

  it("reports user secrets and fallback credentials without returning key material", async () => {
    mockResolveHasCompleteBuilderConnection.mockResolvedValue(true);
    mockResolveSecret.mockImplementation(async (key: string) =>
      key === "OPENAI_API_KEY"
        ? "sk-openai-secret"
        : key === "GROQ_API_KEY"
          ? "configured-secret"
          : null,
    );
    mockResolveGoogleRealtimeCredentials.mockResolvedValue(
      '{"type":"service_account"}',
    );

    const handler = createVoiceProvidersStatusHandler();
    const result = await handler(event());

    expect(result).toEqual({
      builder: true,
      gemini: false,
      openai: true,
      groq: true,
      googleRealtime: true,
      browser: true,
      native: true,
      orgProvider: null,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(mockResolveSecret).toHaveBeenCalledWith("GROQ_API_KEY");
  });

  it("uses the unscoped resolver when there is no session", async () => {
    mockGetSession.mockResolvedValue(null);
    mockResolveSecret.mockImplementation(async (key: string) =>
      key === "GEMINI_API_KEY" ? "gemini-key" : null,
    );

    const handler = createVoiceProvidersStatusHandler();
    const result = await handler(event());

    expect(result).toMatchObject({
      gemini: true,
      openai: false,
      groq: false,
      googleRealtime: false,
    });
    expect(mockResolveSecret).toHaveBeenCalledWith("GEMINI_API_KEY");
  });

  it.each(["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"])(
    "reports Gemini with the key saved as %s",
    async (name) => {
      mockResolveSecret.mockImplementation(async (key: string) =>
        key === name ? "gemini-key" : null,
      );

      const handler = createVoiceProvidersStatusHandler();
      const result = await handler(event());

      expect(result).toMatchObject({ gemini: true, openai: false });
      expect(mockPrefetchSecrets).toHaveBeenCalledWith(
        expect.arrayContaining([
          "GOOGLE_GENERATIVE_AI_API_KEY",
          "GEMINI_API_KEY",
        ]),
      );
    },
  );

  it("reports deploy-managed Google credentials only when they resolve cleanly", async () => {
    mockResolveGoogleRealtimeCredentials.mockResolvedValue(
      '{"type":"service_account"}',
    );

    const handler = createVoiceProvidersStatusHandler();
    const result = await handler(event());

    expect(result).toMatchObject({
      googleRealtime: true,
      openai: false,
      groq: false,
    });
  });

  it("suppresses Google realtime when the configured credential path is unreadable", async () => {
    mockResolveGoogleRealtimeCredentials.mockRejectedValue(
      new Error("unreadable"),
    );

    const handler = createVoiceProvidersStatusHandler();
    const result = await handler(event());

    expect(result).toMatchObject({
      googleRealtime: false,
    });
  });

  it("reports the organization's voice choice for the request's org", async () => {
    mockReadServiceProviderChoice.mockResolvedValue("groq");

    const result = await createVoiceProvidersStatusHandler()(event());

    expect(result).toMatchObject({ orgProvider: "groq" });
    expect(result).not.toHaveProperty("orgProviderLookupFailed");
    expect(mockReadServiceProviderChoice).toHaveBeenCalledWith("voice", {
      orgId: "org-123",
    });
  });

  it("flags an unreadable organization choice instead of reporting it unset", async () => {
    mockReadServiceProviderChoice.mockRejectedValue(new Error("db down"));

    const result = await createVoiceProvidersStatusHandler()(event());

    expect(result).toMatchObject({
      orgProvider: null,
      orgProviderLookupFailed: true,
    });
  });

  it("rejects non-GET requests", async () => {
    const handler = createVoiceProvidersStatusHandler();
    const result = await handler(event("POST"));

    expect(lastStatus).toBe(405);
    expect(result).toEqual({ error: "Method not allowed" });
  });
});
