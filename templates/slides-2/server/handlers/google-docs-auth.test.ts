import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  encodeOAuthState: vi.fn(),
  getAppConfig: vi.fn(() => ({ app: { id: "slides-2-test" } })),
  getGoogleDocsAuthUrl: vi.fn(),
  getQuery: vi.fn(),
  getSession: vi.fn(),
  isElectron: vi.fn(),
  isGoogleDocsOAuthConfigured: vi.fn(),
  resolveOAuthRedirectUri: vi.fn(),
  safeReturnPath: vi.fn(),
  setResponseStatus: vi.fn(),
  withSlidesRequestContext: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  decodeOAuthState: vi.fn(),
  encodeOAuthState: mocks.encodeOAuthState,
  getAppConfig: mocks.getAppConfig,
  getAppUrl: vi.fn(),
  getSession: mocks.getSession,
  getQuery: mocks.getQuery,
  isElectron: mocks.isElectron,
  oauthCallbackResponse: vi.fn(),
  oauthErrorPage: vi.fn(),
  resolveOAuthRedirectUri: mocks.resolveOAuthRedirectUri,
  safeReturnPath: mocks.safeReturnPath,
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: mocks.getQuery,
  setResponseStatus: mocks.setResponseStatus,
}));

vi.mock("../lib/google-docs-error.js", () => ({
  formatGoogleOAuthError: (error: unknown) =>
    error instanceof Error ? `formatted: ${error.message}` : "formatted",
}));

vi.mock("../lib/google-docs-oauth.js", () => ({
  exchangeGoogleDocsCode: vi.fn(),
  getGoogleDocsAuthUrl: mocks.getGoogleDocsAuthUrl,
  isGoogleDocsOAuthConfigured: mocks.isGoogleDocsOAuthConfigured,
}));

vi.mock("./request-auth-context.js", () => ({
  withSlidesRequestContext: mocks.withSlidesRequestContext,
}));

import { getGoogleDocsAuthUrlHandler } from "./google-docs-auth";

describe("getGoogleDocsAuthUrlHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withSlidesRequestContext.mockImplementation(
      async (_event: unknown, callback: () => unknown) => callback(),
    );
    mocks.getSession.mockResolvedValue({ email: "owner@example.com" });
    mocks.isGoogleDocsOAuthConfigured.mockResolvedValue(true);
  });

  it("resolves OAuth setup inside the authenticated request context", async () => {
    mocks.getQuery.mockReturnValue({});
    mocks.resolveOAuthRedirectUri.mockReturnValue(
      "https://slides.example/_agent-native/google-docs/callback",
    );
    mocks.safeReturnPath.mockReturnValue("/home");
    mocks.encodeOAuthState.mockReturnValue("oauth-state");
    mocks.getGoogleDocsAuthUrl.mockResolvedValue(
      "https://accounts.google.com/oauth",
    );

    await expect(getGoogleDocsAuthUrlHandler({} as any)).resolves.toEqual({
      url: "https://accounts.google.com/oauth",
    });
    expect(mocks.withSlidesRequestContext).toHaveBeenCalledTimes(1);
    expect(mocks.isGoogleDocsOAuthConfigured).toHaveBeenCalledWith(
      "owner@example.com",
    );
    expect(mocks.getGoogleDocsAuthUrl).toHaveBeenCalledWith(
      "https://slides.example/_agent-native/google-docs/callback",
      "oauth-state",
      "owner@example.com",
    );
    expect(mocks.encodeOAuthState).toHaveBeenCalledWith(
      expect.objectContaining({ app: "slides-2-test" }),
    );
  });
});
