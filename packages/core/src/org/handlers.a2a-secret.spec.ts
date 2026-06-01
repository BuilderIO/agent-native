import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.fn();
const mockGetOrgContext = vi.fn();
const mockGetSession = vi.fn();
const mockPutUserSetting = vi.fn();
const mockReadBody = vi.fn();
const mockDiscoverAgents = vi.fn();
const mockSignA2AToken = vi.fn();
const mockSsrfSafeFetch = vi.fn();
const mockFetch = vi.fn();

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getRouterParam: vi.fn(),
  getRequestURL: (event: any) =>
    event.url ?? new URL("http://example.test/_agent-native/org"),
  getRequestHeader: (event: any, name: string) =>
    event._headers?.[name.toLowerCase()],
  createError: (opts: { statusCode?: number; message?: string }) =>
    Object.assign(new Error(opts.message ?? "Error"), {
      statusCode: opts.statusCode,
    }),
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: (...args: any[]) => mockReadBody(...args),
}));

vi.mock("../server/auth.js", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
}));

vi.mock("../settings/user-settings.js", () => ({
  putUserSetting: (...args: any[]) => mockPutUserSetting(...args),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mockExecute }),
}));

vi.mock("../server/email.js", () => ({
  sendEmail: vi.fn(),
  isEmailConfigured: () => false,
}));

vi.mock("../server/email-templates.js", () => ({
  renderInviteEmail: vi.fn(),
}));

vi.mock("../server/app-url.js", () => ({
  getAppProductionUrl: () => "https://app.example.test",
}));

vi.mock("./context.js", () => ({
  getOrgContext: (...args: any[]) => mockGetOrgContext(...args),
  createOrganization: vi.fn(),
}));

vi.mock("./free-email-providers.js", () => ({
  isFreeEmailProvider: () => false,
}));

vi.mock("../server/agent-discovery.js", () => ({
  discoverAgents: (...args: any[]) => mockDiscoverAgents(...args),
}));

vi.mock("../a2a/client.js", () => ({
  signA2AToken: (...args: any[]) => mockSignA2AToken(...args),
}));

vi.mock("../extensions/url-safety.js", () => ({
  ssrfSafeFetch: (...args: any[]) => mockSsrfSafeFetch(...args),
}));

import { syncA2ASecretHandler } from "./handlers.js";

describe("syncA2ASecretHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    mockReadBody.mockResolvedValue({});
    mockGetOrgContext.mockResolvedValue({
      email: "owner@example.test",
      orgId: "org_1",
      orgName: "Example",
      role: "owner",
    });
    mockExecute.mockResolvedValue({
      rows: [{ a2a_secret: "local-secret", allowed_domain: "example.test" }],
    });
    mockDiscoverAgents.mockResolvedValue([
      {
        id: "remote",
        name: "Remote",
        description: "",
        url: "https://remote.example.test",
        color: "#000000",
      },
    ]);
    mockSignA2AToken.mockResolvedValue("signed-jwt");
    mockSsrfSafeFetch.mockResolvedValue(new Response("ok", { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts A2A secrets through the SSRF-safe fetch wrapper", async () => {
    const result = await syncA2ASecretHandler({} as any);

    expect(result).toMatchObject({
      total: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      "https://remote.example.test/_agent-native/org/a2a-secret/receive",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer signed-jwt",
        }),
        body: JSON.stringify({
          secret: "local-secret",
          orgDomain: "example.test",
        }),
      }),
      { maxRedirects: 3 },
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("reports SSRF blocks as per-agent failures without falling back to bare fetch", async () => {
    mockDiscoverAgents.mockResolvedValue([
      {
        id: "metadata",
        name: "Metadata",
        description: "",
        url: "http://169.254.169.254",
        color: "#000000",
      },
    ]);
    mockSsrfSafeFetch.mockRejectedValueOnce(
      new Error(
        "SSRF blocked: refusing to fetch private/internal address (http://169.254.169.254)",
      ),
    );

    const result = await syncA2ASecretHandler({} as any);

    expect(result).toMatchObject({
      total: 1,
      succeeded: 0,
      failed: 1,
      results: [
        expect.objectContaining({
          id: "metadata",
          ok: false,
          error: expect.stringContaining("SSRF blocked"),
        }),
      ],
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
