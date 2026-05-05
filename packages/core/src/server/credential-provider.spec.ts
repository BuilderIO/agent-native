import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadAppSecret = vi.fn();
const mockWriteAppSecret = vi.fn();
const mockDeleteAppSecret = vi.fn();
const mockGetRequestUserEmail = vi.fn<[], string | undefined>();
const mockGetRequestOrgId = vi.fn<[], string | undefined>();

vi.mock("../secrets/storage.js", () => ({
  readAppSecret: (...args: any[]) => mockReadAppSecret(...args),
  writeAppSecret: (...args: any[]) => mockWriteAppSecret(...args),
  deleteAppSecret: (...args: any[]) => mockDeleteAppSecret(...args),
}));
vi.mock("./request-context.js", () => ({
  getRequestUserEmail: () => mockGetRequestUserEmail(),
  getRequestOrgId: () => mockGetRequestOrgId(),
}));

import {
  resolveCredentialWriteScope,
  writeBuilderCredentials,
  deleteBuilderCredentials,
  resolveBuilderCredential,
  resolveSecret,
} from "./credential-provider.js";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.BUILDER_PRIVATE_KEY;
  delete process.env.BUILDER_PUBLIC_KEY;
  mockReadAppSecret.mockResolvedValue(null);
  mockWriteAppSecret.mockResolvedValue("id");
  mockDeleteAppSecret.mockResolvedValue(true);
  mockGetRequestUserEmail.mockReturnValue(undefined);
  mockGetRequestOrgId.mockReturnValue(undefined);
});

describe("resolveCredentialWriteScope", () => {
  it("returns org scope for owner", () => {
    expect(resolveCredentialWriteScope("a@b.com", "org_1", "owner")).toEqual({
      scope: "org",
      scopeId: "org_1",
    });
  });

  it("returns org scope for admin", () => {
    expect(resolveCredentialWriteScope("a@b.com", "org_1", "admin")).toEqual({
      scope: "org",
      scopeId: "org_1",
    });
  });

  it("returns user scope for member", () => {
    expect(resolveCredentialWriteScope("a@b.com", "org_1", "member")).toEqual({
      scope: "user",
      scopeId: "a@b.com",
    });
  });

  it("returns user scope when no orgId, regardless of role", () => {
    expect(resolveCredentialWriteScope("a@b.com", null, "owner")).toEqual({
      scope: "user",
      scopeId: "a@b.com",
    });
  });

  it("returns user scope for unknown role", () => {
    expect(resolveCredentialWriteScope("a@b.com", "org_1", null)).toEqual({
      scope: "user",
      scopeId: "a@b.com",
    });
  });
});

describe("writeBuilderCredentials", () => {
  it("writes at user scope without options (legacy callers)", async () => {
    const target = await writeBuilderCredentials("a@b.com", {
      privateKey: "pk",
      publicKey: "pub",
    });
    expect(target).toEqual({ scope: "user", scopeId: "a@b.com" });
    const scopes = mockWriteAppSecret.mock.calls.map((c) => c[0].scope);
    expect(scopes.every((s) => s === "user")).toBe(true);
  });

  it("writes at org scope for an owner of an active org", async () => {
    const target = await writeBuilderCredentials(
      "owner@b.com",
      { privateKey: "pk", publicKey: "pub" },
      { orgId: "builder_io", role: "owner" },
    );
    expect(target).toEqual({ scope: "org", scopeId: "builder_io" });
    const calls = mockWriteAppSecret.mock.calls.map((c) => c[0]);
    expect(calls.every((c) => c.scope === "org")).toBe(true);
    expect(calls.every((c) => c.scopeId === "builder_io")).toBe(true);
    const keys = calls.map((c) => c.key).sort();
    expect(keys).toEqual(["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"]);
  });

  it("writes at user scope for a plain member of an org", async () => {
    const target = await writeBuilderCredentials(
      "member@b.com",
      { privateKey: "pk", publicKey: "pub" },
      { orgId: "builder_io", role: "member" },
    );
    expect(target).toEqual({ scope: "user", scopeId: "member@b.com" });
  });

  it("includes optional fields (userId, orgName, orgKind)", async () => {
    await writeBuilderCredentials(
      "owner@b.com",
      {
        privateKey: "pk",
        publicKey: "pub",
        userId: "u1",
        orgName: "Builder.io",
        orgKind: "team",
      },
      { orgId: "builder_io", role: "owner" },
    );
    const keys = mockWriteAppSecret.mock.calls.map((c) => c[0].key).sort();
    expect(keys).toEqual([
      "BUILDER_ORG_KIND",
      "BUILDER_ORG_NAME",
      "BUILDER_PRIVATE_KEY",
      "BUILDER_PUBLIC_KEY",
      "BUILDER_USER_ID",
    ]);
  });
});

describe("deleteBuilderCredentials", () => {
  it("deletes at user scope without options", async () => {
    await deleteBuilderCredentials("a@b.com");
    const scopes = mockDeleteAppSecret.mock.calls.map((c) => c[0].scope);
    expect(scopes.every((s) => s === "user")).toBe(true);
  });

  it("deletes at org scope for an owner — undoes a connect that landed at org scope", async () => {
    const target = await deleteBuilderCredentials("owner@b.com", {
      orgId: "builder_io",
      role: "owner",
    });
    expect(target).toEqual({ scope: "org", scopeId: "builder_io" });
    expect(
      mockDeleteAppSecret.mock.calls.every((c) => c[0].scope === "org"),
    ).toBe(true);
  });

  it("deletes at user scope for a plain member — never nukes the org-shared row", async () => {
    const target = await deleteBuilderCredentials("member@b.com", {
      orgId: "builder_io",
      role: "member",
    });
    expect(target).toEqual({ scope: "user", scopeId: "member@b.com" });
  });
});

describe("resolveBuilderCredential", () => {
  it("returns null without a request user", async () => {
    mockGetRequestUserEmail.mockReturnValue(undefined);
    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBeNull();
    expect(mockReadAppSecret).not.toHaveBeenCalled();
  });

  it("returns env value when set (deploy-managed mode beats per-user/org)", async () => {
    process.env.BUILDER_PRIVATE_KEY = "deploy-key";
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBe(
      "deploy-key",
    );
    expect(mockReadAppSecret).not.toHaveBeenCalled();
  });

  it("falls back to org scope when no user-scope row exists", async () => {
    mockGetRequestUserEmail.mockReturnValue("member@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret
      .mockResolvedValueOnce(null) // user scope miss
      .mockResolvedValueOnce({ value: "org-key", last4: "-key", updatedAt: 1 });
    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBe(
      "org-key",
    );
    const refs = mockReadAppSecret.mock.calls.map((c) => c[0]);
    expect(refs[0]).toEqual({
      key: "BUILDER_PRIVATE_KEY",
      scope: "user",
      scopeId: "member@b.com",
    });
    expect(refs[1]).toEqual({
      key: "BUILDER_PRIVATE_KEY",
      scope: "org",
      scopeId: "builder_io",
    });
  });

  it("user-scope override wins over org-scope row", async () => {
    mockGetRequestUserEmail.mockReturnValue("dev@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockResolvedValueOnce({
      value: "personal-key",
      last4: "-key",
      updatedAt: 1,
    });
    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBe(
      "personal-key",
    );
    expect(mockReadAppSecret).toHaveBeenCalledTimes(1);
  });

  it("returns null when neither user nor org scope has the key", async () => {
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockResolvedValue(null);
    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBeNull();
  });

  it("does not check org scope when caller has no active org", async () => {
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockGetRequestOrgId.mockReturnValue(undefined);
    mockReadAppSecret.mockResolvedValue(null);
    expect(await resolveBuilderCredential("BUILDER_PRIVATE_KEY")).toBeNull();
    expect(mockReadAppSecret).toHaveBeenCalledTimes(1);
    expect(mockReadAppSecret.mock.calls[0][0].scope).toBe("user");
  });
});

describe("resolveSecret (generic)", () => {
  it("falls back to org scope for arbitrary keys (e.g. OPENAI_API_KEY)", async () => {
    mockGetRequestUserEmail.mockReturnValue("teammate@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret.mockResolvedValueOnce(null).mockResolvedValueOnce({
      value: "sk-...shared",
      last4: "ared",
      updatedAt: 1,
    });
    expect(await resolveSecret("OPENAI_API_KEY")).toBe("sk-...shared");
  });

  it("falls back to workspace scope for registered shared secrets", async () => {
    mockGetRequestUserEmail.mockReturnValue("teammate@b.com");
    mockGetRequestOrgId.mockReturnValue("builder_io");
    mockReadAppSecret
      .mockResolvedValueOnce(null) // user scope miss
      .mockResolvedValueOnce(null) // org scope miss
      .mockResolvedValueOnce({
        value: "workspace-secret",
        last4: "cret",
        updatedAt: 1,
      });
    expect(await resolveSecret("GOOGLE_CLIENT_SECRET")).toBe(
      "workspace-secret",
    );
    expect(mockReadAppSecret.mock.calls.map((c) => c[0].scope)).toEqual([
      "user",
      "org",
      "workspace",
    ]);
  });

  it("checks solo workspace scope when an authenticated user has no org", async () => {
    mockGetRequestUserEmail.mockReturnValue("solo@b.com");
    mockGetRequestOrgId.mockReturnValue(undefined);
    mockReadAppSecret
      .mockResolvedValueOnce(null) // user scope miss
      .mockResolvedValueOnce({
        value: "solo-workspace-secret",
        last4: "cret",
        updatedAt: 1,
      });
    expect(await resolveSecret("GOOGLE_CLIENT_SECRET")).toBe(
      "solo-workspace-secret",
    );
    expect(mockReadAppSecret.mock.calls.map((c) => c[0])).toEqual([
      {
        key: "GOOGLE_CLIENT_SECRET",
        scope: "user",
        scopeId: "solo@b.com",
      },
      {
        key: "GOOGLE_CLIENT_SECRET",
        scope: "workspace",
        scopeId: "solo:solo@b.com",
      },
    ]);
  });

  it("does not consult process.env in an authenticated request", async () => {
    process.env.OPENAI_API_KEY = "deploy-key";
    mockGetRequestUserEmail.mockReturnValue("a@b.com");
    mockReadAppSecret.mockResolvedValue(null);
    expect(await resolveSecret("OPENAI_API_KEY")).toBeNull();
    delete process.env.OPENAI_API_KEY;
  });

  it("uses process.env outside an authenticated request (CLI / unauth)", async () => {
    process.env.SOME_KEY = "v";
    mockGetRequestUserEmail.mockReturnValue(undefined);
    expect(await resolveSecret("SOME_KEY")).toBe("v");
    delete process.env.SOME_KEY;
  });
});
