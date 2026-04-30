import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockReadAppSecret = vi.fn();
const mockResolveCredential = vi.fn();
const mockResolveHasBuilderPrivateKey = vi.fn();

let lastStatus = 200;

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getMethod: (event: any) => event._method ?? "GET",
  setResponseStatus: (_event: any, code: number) => {
    lastStatus = code;
  },
}));

vi.mock("../secrets/storage.js", () => ({
  readAppSecret: (...args: any[]) => mockReadAppSecret(...args),
}));

vi.mock("../credentials/index.js", () => ({
  resolveCredential: (...args: any[]) => mockResolveCredential(...args),
}));

vi.mock("./auth.js", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
}));

vi.mock("./credential-provider.js", () => ({
  resolveHasBuilderPrivateKey: (...args: any[]) =>
    mockResolveHasBuilderPrivateKey(...args),
}));

import { createVoiceProvidersStatusHandler } from "./voice-providers-status.js";

function event(method = "GET") {
  return { _method: method };
}

describe("voice providers status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastStatus = 200;
    mockGetSession.mockResolvedValue({ email: "voice+qa@example.com" });
    mockReadAppSecret.mockResolvedValue(null);
    mockResolveCredential.mockResolvedValue(undefined);
    mockResolveHasBuilderPrivateKey.mockResolvedValue(false);
  });

  it("reports user secrets and fallback credentials without returning key material", async () => {
    mockResolveHasBuilderPrivateKey.mockResolvedValue(true);
    mockReadAppSecret.mockImplementation(async ({ key }) =>
      key === "OPENAI_API_KEY" ? { value: "sk-openai-secret" } : null,
    );
    mockResolveCredential.mockImplementation(async (key: string) =>
      key === "GROQ_API_KEY" ? "gsk-groq-secret" : undefined,
    );

    const handler = createVoiceProvidersStatusHandler();
    const result = await handler(event());

    expect(result).toEqual({
      builder: true,
      gemini: false,
      openai: true,
      groq: true,
      browser: true,
      native: true,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(mockResolveCredential).toHaveBeenCalledWith("GROQ_API_KEY", {
      userEmail: "voice+qa@example.com",
    });
  });

  it("falls back to process/sql credentials when there is no session", async () => {
    mockGetSession.mockResolvedValue(null);
    mockResolveCredential.mockImplementation(async (key: string) =>
      key === "GEMINI_API_KEY" ? "gemini-key" : undefined,
    );

    const handler = createVoiceProvidersStatusHandler();
    const result = await handler(event());

    expect(result).toMatchObject({ gemini: true, openai: false, groq: false });
    expect(mockReadAppSecret).not.toHaveBeenCalled();
    expect(mockResolveCredential).toHaveBeenCalledWith("GEMINI_API_KEY", {
      userEmail: undefined,
    });
  });

  it("rejects non-GET requests", async () => {
    const handler = createVoiceProvidersStatusHandler();
    const result = await handler(event("POST"));

    expect(lastStatus).toBe(405);
    expect(result).toEqual({ error: "Method not allowed" });
  });
});
