import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockResolveHasBuilderPrivateKey = vi.fn();
const mockResolveSecret = vi.fn();
const mockGetOrgContext = vi.fn();
const mockResolveGoogleRealtimeCredentials = vi.fn();

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
  resolveHasBuilderPrivateKey: (...args: any[]) =>
    mockResolveHasBuilderPrivateKey(...args),
  resolveSecret: (...args: any[]) => mockResolveSecret(...args),
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
    mockResolveHasBuilderPrivateKey.mockResolvedValue(false);
    mockGetOrgContext.mockResolvedValue({ orgId: "org-123" });
    mockResolveGoogleRealtimeCredentials.mockResolvedValue(null);
  });

  afterEach(() => {
    if (originalGoogleCredsEnv === undefined) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    } else {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = originalGoogleCredsEnv;
    }
  });

  it("reports user secrets and fallback credentials without returning key material", async () => {
    mockResolveHasBuilderPrivateKey.mockResolvedValue(true);
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

  it("rejects non-GET requests", async () => {
    const handler = createVoiceProvidersStatusHandler();
    const result = await handler(event("POST"));

    expect(lastStatus).toBe(405);
    expect(result).toEqual({ error: "Method not allowed" });
  });
});
