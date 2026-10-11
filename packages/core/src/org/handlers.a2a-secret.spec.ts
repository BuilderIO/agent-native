import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.fn();
const mockGetOrgContext = vi.fn();
const mockGetSession = vi.fn();
const mockPutUserSetting = vi.fn();
const mockGetOrgSetting = vi.fn();
const mockReadBody = vi.fn();
const mockDiscoverAgents = vi.fn();
const mockSignA2AToken = vi.fn();
const mockSignA2AOrganizationToken = vi.fn();
const mockGetGlobalA2ASecret = vi.fn<() => string | undefined>();
const mockVerifyA2AToken = vi.fn();
const mockCanonicalA2AAudience = vi.fn((url: string) =>
  url.replace(/\/+$/, ""),
);
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

vi.mock("../settings/org-settings.js", () => ({
  getOrgSetting: (...args: any[]) => mockGetOrgSetting(...args),
  putOrgSetting: vi.fn(),
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
  getGlobalA2ASecret: () => mockGetGlobalA2ASecret(),
  signA2AToken: (...args: any[]) => mockSignA2AToken(...args),
  signA2AOrganizationToken: (...args: any[]) =>
    mockSignA2AOrganizationToken(...args),
}));

vi.mock("../a2a/server.js", () => ({
  verifyA2AToken: (...args: any[]) => mockVerifyA2AToken(...args),
}));

vi.mock("../a2a/audience.js", () => ({
  canonicalA2AAudience: (...args: any[]) => mockCanonicalA2AAudience(...args),
}));

vi.mock("../extensions/url-safety.js", () => ({
  ssrfSafeFetch: (...args: any[]) => mockSsrfSafeFetch(...args),
}));

vi.mock("../server/social-sign-in-providers.js", () => ({
  resolveDeploymentSignInMethods: () => ({
    emailPassword: true,
    google: true,
    github: false,
  }),
}));

import {
  getMyOrgHandler,
  receiveA2ASecretHandler,
  revealA2ASecretHandler,
  setA2ASecretHandler,
  syncA2ASecretHandler,
} from "./handlers.js";

const ADMIN_CONTEXT = {
  email: "admin@example.test",
  orgId: "org_1",
  orgName: "Example",
  role: "admin",
};

describe("cross-app secret handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrgContext.mockResolvedValue(ADMIN_CONTEXT);
    mockReadBody.mockResolvedValue({});
  });

  it.each([
    ["reveal", revealA2ASecretHandler],
    ["set", setA2ASecretHandler],
    ["sync", syncA2ASecretHandler],
  ])("rejects an admin trying to %s it", async (_name, handler) => {
    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe("syncA2ASecretHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrgSetting.mockResolvedValue(null);
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
    mockSignA2AOrganizationToken.mockResolvedValue("signed-jwt");
    mockCanonicalA2AAudience.mockImplementation((url) =>
      url.replace(/\/+$/, ""),
    );
    mockSsrfSafeFetch.mockResolvedValue(new Response("ok", { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts A2A secrets through the SSRF-safe fetch wrapper", async () => {
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "test-vercel-bypass");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "remote.example.test");
    const result = await syncA2ASecretHandler({} as any);

    expect(result).toMatchObject({
      total: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(mockSignA2AOrganizationToken).toHaveBeenCalledWith(
      "example.test",
      "local-secret",
      undefined,
      {
        preferGlobalSecret: false,
        audience: "https://remote.example.test",
      },
    );
    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      "https://remote.example.test/_agent-native/org/a2a-secret/receive",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer signed-jwt",
          "x-vercel-protection-bypass": "test-vercel-bypass",
        }),
        body: JSON.stringify({
          secret: "local-secret",
          orgDomain: "example.test",
        }),
      }),
      { maxRedirects: 3, followRedirects: false },
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

describe("org A2A secret equal to the deployment A2A_SECRET", () => {
  const OWNER_CONTEXT = { ...ADMIN_CONTEXT, role: "owner" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGlobalA2ASecret.mockReturnValue("deploy-secret");
    mockGetOrgContext.mockResolvedValue(OWNER_CONTEXT);
    mockExecute.mockResolvedValue({
      rows: [{ id: "org_1", a2a_secret: "existing-org-secret" }],
    });
  });

  describe("setA2ASecretHandler", () => {
    it("refuses the deployment secret even with surrounding whitespace", async () => {
      mockReadBody.mockResolvedValue({ secret: "  deploy-secret " });

      await expect(setA2ASecretHandler({} as any)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining("must differ"),
      });
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("saves a distinct secret", async () => {
      mockReadBody.mockResolvedValue({ secret: "distinct-org-secret" });

      await expect(setA2ASecretHandler({} as any)).resolves.toMatchObject({
        a2aSecret: "distinct-org-secret",
      });
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: expect.stringContaining("UPDATE organizations"),
          args: ["distinct-org-secret", "org_1"],
        }),
      );
    });

    it("saves any secret when no deployment secret is configured", async () => {
      mockGetGlobalA2ASecret.mockReturnValue(undefined);
      mockReadBody.mockResolvedValue({ secret: "deploy-secret" });

      await expect(setA2ASecretHandler({} as any)).resolves.toMatchObject({
        a2aSecret: "deploy-secret",
      });
    });

    it("rotates away from a stored secret equal to the deployment secret", async () => {
      mockExecute.mockResolvedValue({
        rows: [{ id: "org_1", a2a_secret: "deploy-secret" }],
      });
      mockReadBody.mockResolvedValue({ secret: "distinct-org-secret" });

      await expect(setA2ASecretHandler({} as any)).resolves.toEqual({
        a2aSecret: "distinct-org-secret",
        previousSecret: "deploy-secret",
      });
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: expect.stringContaining("UPDATE organizations"),
          args: ["distinct-org-secret", "org_1"],
        }),
      );
    });
  });

  describe("receiveA2ASecretHandler", () => {
    const receive = async (
      pushedSecret: string,
      storedSecret = "existing-org-secret",
    ) => {
      mockExecute.mockResolvedValue({
        rows: [{ id: "org_1", a2a_secret: storedSecret }],
      });
      const token = await new jose.SignJWT({ org_domain: "example.test" })
        .setProtectedHeader({ alg: "HS256" })
        .sign(new TextEncoder().encode(storedSecret));
      mockReadBody.mockResolvedValue({
        secret: pushedSecret,
        orgDomain: "example.test",
      });
      mockVerifyA2AToken.mockResolvedValue({
        email: null,
        orgId: "org_1",
        orgDomain: "example.test",
      });
      return receiveA2ASecretHandler({
        _headers: { authorization: `Bearer ${token}` },
      } as any);
    };

    it("fails the sync push loudly instead of silently demoting the org", async () => {
      await expect(receive("deploy-secret")).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining("equals this app's A2A_SECRET"),
      });
      expect(mockExecute).not.toHaveBeenCalledWith(
        expect.objectContaining({
          sql: expect.stringContaining("UPDATE organizations"),
        }),
      );
    });

    it("does not reveal whether a value matches before the caller is verified", async () => {
      mockVerifyA2AToken.mockResolvedValue({ email: null, orgDomain: null });
      const token = await new jose.SignJWT({ org_domain: "example.test" })
        .setProtectedHeader({ alg: "HS256" })
        .sign(new TextEncoder().encode("wrong-secret"));
      mockReadBody.mockResolvedValue({
        secret: "deploy-secret",
        orgDomain: "example.test",
      });

      await expect(
        receiveA2ASecretHandler({
          _headers: { authorization: `Bearer ${token}` },
        } as any),
      ).rejects.toMatchObject({ statusCode: 401 });
    });

    it("stores a distinct pushed secret", async () => {
      await expect(receive("distinct-org-secret")).resolves.toEqual({
        ok: true,
        orgId: "org_1",
      });
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: expect.stringContaining("UPDATE organizations"),
          args: ["distinct-org-secret", "org_1"],
        }),
      );
    });

    it("rotates away from a stored secret equal to the deployment secret", async () => {
      await expect(
        receive("distinct-org-secret", "deploy-secret"),
      ).resolves.toEqual({ ok: true, orgId: "org_1" });
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: expect.stringContaining("UPDATE organizations"),
          args: ["distinct-org-secret", "org_1"],
        }),
      );
    });

    it("stores the pushed secret when no deployment secret is configured", async () => {
      mockGetGlobalA2ASecret.mockReturnValue(undefined);

      await expect(receive("deploy-secret")).resolves.toMatchObject({
        ok: true,
      });
    });
  });
});

describe("getMyOrgHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrgSetting.mockResolvedValue(null);
    mockGetOrgContext.mockResolvedValue({
      email: "owner@example.test",
      orgId: "org_1",
      orgName: "Example",
      role: "owner",
    });
    mockExecute.mockImplementation(async ({ sql }: { sql: string }) =>
      sql.includes("a2a_secret")
        ? {
            rows: [
              {
                allowed_domain: "example.test",
                a2a_secret: "example-stored-secret",
              },
            ],
          }
        : { rows: [] },
    );
  });

  it("reports that a secret exists without serializing its value", async () => {
    const result = (await getMyOrgHandler({} as any)) as Record<
      string,
      unknown
    >;

    expect(result.a2aSecretSet).toBe(true);
    expect(Object.keys(result)).not.toContain("a2aSecret");
    expect(JSON.stringify(result)).not.toContain("example-stored-secret");
  });

  it("omits the indicator entirely for plain members", async () => {
    mockGetOrgContext.mockResolvedValue({
      email: "member@example.test",
      orgId: "org_1",
      orgName: "Example",
      role: "member",
    });

    const result = (await getMyOrgHandler({} as any)) as Record<
      string,
      unknown
    >;

    expect(result.a2aSecretSet).toBeUndefined();
    expect(result.signInMethods).toBeUndefined();
  });

  it("gives an admin the sign-in methods but not the secret indicator", async () => {
    mockGetOrgContext.mockResolvedValue(ADMIN_CONTEXT);

    const result = (await getMyOrgHandler({} as any)) as Record<
      string,
      unknown
    >;

    expect(result.a2aSecretSet).toBeUndefined();
    expect(result.signInMethods).toEqual({
      emailPassword: true,
      google: true,
      github: false,
    });
  });

  it("fails instead of reporting org visibility when the default cannot be read", async () => {
    mockGetOrgSetting.mockRejectedValueOnce(
      new Error("settings database unavailable"),
    );

    await expect(getMyOrgHandler({} as any)).rejects.toThrow(
      "settings database unavailable",
    );
  });
});

describe("revealA2ASecretHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrgContext.mockResolvedValue({
      email: "owner@example.test",
      orgId: "org_1",
      orgName: "Example",
      role: "owner",
    });
    mockExecute.mockResolvedValue({
      rows: [{ a2a_secret: "example-stored-secret" }],
    });
  });

  it("returns the secret for an owner that explicitly asks for it", async () => {
    const result = (await revealA2ASecretHandler({} as any)) as {
      a2aSecret: string | null;
    };

    expect(result.a2aSecret).toBe("example-stored-secret");
  });

  it("rejects members who are not owners or admins", async () => {
    mockGetOrgContext.mockResolvedValue({
      email: "member@example.test",
      orgId: "org_1",
      orgName: "Example",
      role: "member",
    });

    await expect(revealA2ASecretHandler({} as any)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
