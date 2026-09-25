import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrgSetting: vi.fn(),
  mutateOrgSetting: vi.fn(),
  execute: vi.fn(),
  resolveOrgIdForEmail: vi.fn(),
  getOrgContext: vi.fn(),
  request: {
    ctx: undefined as object | undefined,
    email: undefined as string | undefined,
    orgId: undefined as string | undefined,
  },
}));

vi.mock("../settings/org-settings.js", () => ({
  getOrgSetting: mocks.getOrgSetting,
  mutateOrgSetting: mocks.mutateOrgSetting,
}));
vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
}));
vi.mock("../org/context.js", () => ({
  resolveOrgIdForEmail: mocks.resolveOrgIdForEmail,
  getOrgContext: mocks.getOrgContext,
}));
vi.mock("./request-context.js", () => ({
  getRequestContext: () => mocks.request.ctx,
  getRequestUserEmail: () => mocks.request.email,
  getRequestOrgId: () => mocks.request.orgId,
}));

import {
  isPersonalProviderKeyUseRestricted,
  isPersonalProviderPolicyKey,
  personalProviderKeyWriteDenial,
  readPersonalProviderKeyPolicy,
  resolvePersonalProviderKeySaveDenial,
  writePersonalProviderKeyPolicy,
} from "./personal-provider-key-policy.js";

function restricted(value: boolean) {
  mocks.getOrgSetting.mockImplementation(async (_orgId, key) =>
    key === "restrict-personal-provider-keys"
      ? { restricted: value, updatedAt: 5, updatedBy: "owner@example.com" }
      : null,
  );
}

function role(value: string | null) {
  mocks.execute.mockResolvedValue({ rows: value ? [{ role: value }] : [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.ctx = undefined;
  mocks.request.email = undefined;
  mocks.request.orgId = undefined;
  mocks.getOrgSetting.mockResolvedValue(null);
  mocks.resolveOrgIdForEmail.mockResolvedValue(null);
  role("member");
});

describe("isPersonalProviderPolicyKey", () => {
  it("covers model provider keys, their endpoints, and the Builder.io key pair only", () => {
    for (const key of [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
      "OLLAMA_BASE_URL",
      "GOOGLE_GENERATIVE_AI_API_KEY",
      "GEMINI_API_KEY",
      "OPENROUTER_API_KEY",
      "BUILDER_PRIVATE_KEY",
      "BUILDER_PUBLIC_KEY",
    ]) {
      expect(isPersonalProviderPolicyKey(key)).toBe(true);
    }
    for (const key of ["NOTION_TOKEN", "RESEND_API_KEY", "S3_BUCKET"]) {
      expect(isPersonalProviderPolicyKey(key)).toBe(false);
    }
  });
});

describe("isPersonalProviderKeyUseRestricted", () => {
  it("restricts members of a restricted org", async () => {
    restricted(true);
    await expect(
      isPersonalProviderKeyUseRestricted({
        email: "Member@Example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(true);
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["org-1", "member@example.com"] }),
    );
  });

  it("never restricts owners and admins", async () => {
    restricted(true);
    for (const value of ["owner", "admin"]) {
      role(value);
      await expect(
        isPersonalProviderKeyUseRestricted({
          email: "lead@example.com",
          orgId: "org-1",
        }),
      ).resolves.toBe(false);
    }
    // A role the caller already read skips the lookup.
    mocks.execute.mockClear();
    await expect(
      isPersonalProviderKeyUseRestricted({
        email: "lead@example.com",
        orgId: "org-1",
        role: "admin",
      }),
    ).resolves.toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("reads no role while the org allows personal keys", async () => {
    restricted(false);
    await expect(
      isPersonalProviderKeyUseRestricted({
        email: "member@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("never restricts a caller with no organization", async () => {
    restricted(true);
    await expect(
      isPersonalProviderKeyUseRestricted({
        email: "member@example.com",
        orgId: null,
      }),
    ).resolves.toBe(false);
    await expect(
      isPersonalProviderKeyUseRestricted({ email: "member@example.com" }),
    ).resolves.toBe(false);
    expect(mocks.getOrgSetting).not.toHaveBeenCalled();
  });

  it("uses the request's org for the request's own user, else their active org", async () => {
    restricted(true);
    mocks.request.email = "member@example.com";
    mocks.request.orgId = "org-request";
    await isPersonalProviderKeyUseRestricted({ email: "member@example.com" });
    expect(mocks.getOrgSetting).toHaveBeenLastCalledWith(
      "org-request",
      "restrict-personal-provider-keys",
    );
    expect(mocks.resolveOrgIdForEmail).not.toHaveBeenCalled();

    mocks.resolveOrgIdForEmail.mockResolvedValue("org-active");
    await isPersonalProviderKeyUseRestricted({ email: "other@example.com" });
    expect(mocks.resolveOrgIdForEmail).toHaveBeenCalledWith(
      "other@example.com",
    );
    expect(mocks.getOrgSetting).toHaveBeenLastCalledWith(
      "org-active",
      "restrict-personal-provider-keys",
    );
  });

  it("throws when the policy or role can't be read", async () => {
    mocks.getOrgSetting.mockRejectedValue(new Error("settings unavailable"));
    await expect(
      isPersonalProviderKeyUseRestricted({
        email: "member@example.com",
        orgId: "org-1",
      }),
    ).rejects.toThrow("settings unavailable");

    restricted(true);
    mocks.execute.mockRejectedValue(new Error("org_members unavailable"));
    await expect(
      isPersonalProviderKeyUseRestricted({
        email: "member@example.com",
        orgId: "org-1",
      }),
    ).rejects.toThrow("org_members unavailable");
  });

  it("answers once per request and retries a failed read", async () => {
    mocks.request.ctx = {};
    mocks.getOrgSetting.mockRejectedValueOnce(new Error("blip"));
    const input = { email: "member@example.com", orgId: "org-1" };
    await expect(isPersonalProviderKeyUseRestricted(input)).rejects.toThrow(
      "blip",
    );
    restricted(true);
    await expect(isPersonalProviderKeyUseRestricted(input)).resolves.toBe(true);
    await expect(isPersonalProviderKeyUseRestricted(input)).resolves.toBe(true);
    expect(mocks.getOrgSetting).toHaveBeenCalledTimes(2);
  });
});

describe("policy reads and writes", () => {
  it("reads an unset policy as allowed", async () => {
    await expect(readPersonalProviderKeyPolicy("org-1")).resolves.toEqual({
      restricted: false,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("reports whether a write changed the policy and drops this request's answers", async () => {
    mocks.request.ctx = {};
    restricted(false);
    const input = { email: "member@example.com", orgId: "org-1" };
    await expect(isPersonalProviderKeyUseRestricted(input)).resolves.toBe(
      false,
    );

    let stored: Record<string, unknown> | null = { restricted: false };
    mocks.mutateOrgSetting.mockImplementation(async (_orgId, _key, update) => {
      stored = await update(stored);
      return stored;
    });
    const first = await writePersonalProviderKeyPolicy("org-1", {
      restricted: true,
      updatedBy: "owner@example.com",
    });
    expect(first).toMatchObject({
      changed: true,
      policy: { restricted: true, updatedBy: "owner@example.com" },
    });
    const again = await writePersonalProviderKeyPolicy("org-1", {
      restricted: true,
      updatedBy: "owner@example.com",
    });
    expect(again.changed).toBe(false);

    restricted(true);
    await expect(isPersonalProviderKeyUseRestricted(input)).resolves.toBe(true);
  });
});

describe("personal save denials", () => {
  it("refuses only policy keys, and only for restricted callers", async () => {
    restricted(true);
    await expect(
      personalProviderKeyWriteDenial({
        key: "ANTHROPIC_API_KEY",
        email: "member@example.com",
        orgId: "org-1",
        role: "member",
      }),
    ).resolves.toBe("Owners and admins restricted personal API keys.");
    await expect(
      personalProviderKeyWriteDenial({
        key: "NOTION_TOKEN",
        email: "member@example.com",
        orgId: "org-1",
        role: "member",
      }),
    ).resolves.toBeNull();
    await expect(
      personalProviderKeyWriteDenial({
        key: "ANTHROPIC_API_KEY",
        email: "owner@example.com",
        orgId: "org-1",
        role: "owner",
      }),
    ).resolves.toBeNull();
  });

  it("reads the route's org and role from the request", async () => {
    restricted(true);
    mocks.getOrgContext.mockResolvedValue({ orgId: "org-1", role: "member" });
    await expect(
      resolvePersonalProviderKeySaveDenial(
        {} as never,
        "member@example.com",
        "OPENAI_API_KEY",
      ),
    ).resolves.toBe("Owners and admins restricted personal API keys.");
    expect(mocks.execute).not.toHaveBeenCalled();

    mocks.getOrgContext.mockRejectedValue(new Error("org unreadable"));
    await expect(
      resolvePersonalProviderKeySaveDenial(
        {} as never,
        "member@example.com",
        "OPENAI_API_KEY",
      ),
    ).rejects.toThrow("org unreadable");
  });
});
