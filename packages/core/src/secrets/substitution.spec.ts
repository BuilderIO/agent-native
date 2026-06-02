import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadAppSecret = vi.fn();
const mockReadAppSecretMeta = vi.fn();
const mockGetRequestOrgId = vi.fn();
const mockGetRequestUserEmail = vi.fn();
const mockResolveCredentialForScope = vi.fn();

vi.mock("./storage.js", () => ({
  readAppSecret: (...args: any[]) => mockReadAppSecret(...args),
  readAppSecretMeta: (...args: any[]) => mockReadAppSecretMeta(...args),
}));

vi.mock("../server/request-context.js", () => ({
  getRequestOrgId: (...args: any[]) => mockGetRequestOrgId(...args),
  getRequestUserEmail: (...args: any[]) => mockGetRequestUserEmail(...args),
}));

vi.mock("../credentials/index.js", () => ({
  resolveCredentialForScope: (...args: any[]) =>
    mockResolveCredentialForScope(...args),
}));

import {
  getKeyAllowlist,
  getResolvedKeyAllowlist,
  resolveKeyReferences,
  resolveKeyReferencesWithRequestScopes,
  validateUrlAllowlist,
} from "./substitution.js";

const ORIGINAL_FALLBACK_ENV = process.env.AGENT_NATIVE_KEYS_WORKSPACE_FALLBACK;

afterEach(() => {
  if (ORIGINAL_FALLBACK_ENV === undefined) {
    delete process.env.AGENT_NATIVE_KEYS_WORKSPACE_FALLBACK;
  } else {
    process.env.AGENT_NATIVE_KEYS_WORKSPACE_FALLBACK = ORIGINAL_FALLBACK_ENV;
  }
});

describe("resolveKeyReferencesWithRequestScopes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequestOrgId.mockReturnValue("org_123");
    mockGetRequestUserEmail.mockReturnValue("alice@example.test");
    mockReadAppSecret.mockResolvedValue(null);
    mockReadAppSecretMeta.mockResolvedValue(null);
    mockResolveCredentialForScope.mockResolvedValue(undefined);
  });

  it("falls back from user scope to active org scope", async () => {
    mockReadAppSecret.mockImplementation(async ({ scope }) =>
      scope === "org" ? { value: "org-token" } : null,
    );

    const result = await resolveKeyReferencesWithRequestScopes(
      "Bearer ${keys.GITHUB_TOKEN}",
      "alice@example.test",
    );

    expect(result.resolved).toBe("Bearer org-token");
    expect(result.usedKeys).toEqual(["GITHUB_TOKEN"]);
    expect(result.secretValues).toEqual(["org-token"]);
    expect(result.resolvedKeys).toEqual([
      {
        name: "GITHUB_TOKEN",
        scope: "org",
        scopeId: "org_123",
      },
    ]);
    expect(mockReadAppSecret).toHaveBeenCalledWith({
      key: "GITHUB_TOKEN",
      scope: "user",
      scopeId: "alice@example.test",
    });
    expect(mockReadAppSecret).toHaveBeenCalledWith({
      key: "GITHUB_TOKEN",
      scope: "org",
      scopeId: "org_123",
    });
  });

  it("uses solo workspace scope when no org is active and never queries an org scope", async () => {
    mockGetRequestOrgId.mockReturnValue(null);
    mockGetRequestUserEmail.mockReturnValue("alice@example.test");
    mockReadAppSecret.mockImplementation(async ({ scope, scopeId }) =>
      scope === "workspace" && scopeId === "solo:alice@example.test"
        ? { value: "solo-token" }
        : null,
    );

    const result = await resolveKeyReferencesWithRequestScopes(
      "token=${keys.API_TOKEN}",
      "alice@example.test",
    );

    expect(result.resolved).toBe("token=solo-token");
    expect(result.resolvedKeys).toEqual([
      {
        name: "API_TOKEN",
        scope: "workspace",
        scopeId: "solo:alice@example.test",
      },
    ]);
    // With no active org the candidate set is [user, solo-workspace] only — an
    // org-scoped row must never be consulted (no cross-org leakage path).
    const consultedScopes = mockReadAppSecret.mock.calls.map((c) => c[0].scope);
    expect(consultedScopes).not.toContain("org");
  });

  it("returns the user-scope value without consulting org or workspace scopes (first-hit precedence)", async () => {
    // A personal override must win, and lower-precedence scopes must NOT be
    // read once it is found — otherwise a shared org/workspace row could leak
    // metadata reads or shadow the user's own value.
    mockReadAppSecret.mockImplementation(async ({ scope }) =>
      scope === "user"
        ? { value: "personal-token" }
        : { value: "shared-token" },
    );

    const result = await resolveKeyReferencesWithRequestScopes(
      "Bearer ${keys.GITHUB_TOKEN}",
      "alice@example.test",
    );

    expect(result.resolved).toBe("Bearer personal-token");
    expect(result.resolvedKeys).toEqual([
      { name: "GITHUB_TOKEN", scope: "user", scopeId: "alice@example.test" },
    ]);
    // Only the user scope was queried — org/workspace candidates short-circuit.
    expect(mockReadAppSecret).toHaveBeenCalledTimes(1);
    expect(mockReadAppSecret).toHaveBeenCalledWith({
      key: "GITHUB_TOKEN",
      scope: "user",
      scopeId: "alice@example.test",
    });
    // The legacy credential store is never reached when a scoped row resolves.
    expect(mockResolveCredentialForScope).not.toHaveBeenCalled();
  });

  it("falls back to a legacy user credential after scoped secrets miss", async () => {
    mockResolveCredentialForScope.mockImplementation(async (_key, { scope }) =>
      scope === "user" ? "legacy-user-token" : undefined,
    );

    const result = await resolveKeyReferencesWithRequestScopes(
      "Bearer ${keys.GITHUB_TOKEN}",
      "alice@example.test",
    );

    expect(result.resolved).toBe("Bearer legacy-user-token");
    expect(result.secretValues).toEqual(["legacy-user-token"]);
    expect(result.resolvedKeys).toEqual([
      {
        name: "GITHUB_TOKEN",
        scope: "user",
        scopeId: "alice@example.test",
      },
    ]);
    expect(mockResolveCredentialForScope).toHaveBeenCalledWith("GITHUB_TOKEN", {
      userEmail: "alice@example.test",
      orgId: "org_123",
      scope: "user",
    });
  });

  it("falls back to a legacy org credential after user credential misses", async () => {
    mockResolveCredentialForScope.mockImplementation(async (_key, { scope }) =>
      scope === "org" ? "legacy-org-token" : undefined,
    );

    const result = await resolveKeyReferencesWithRequestScopes(
      "Bearer ${keys.GITHUB_TOKEN}",
      "alice@example.test",
    );

    expect(result.resolved).toBe("Bearer legacy-org-token");
    expect(result.secretValues).toEqual(["legacy-org-token"]);
    expect(result.resolvedKeys).toEqual([
      {
        name: "GITHUB_TOKEN",
        scope: "org",
        scopeId: "org_123",
      },
    ]);
    expect(mockResolveCredentialForScope).toHaveBeenCalledWith("GITHUB_TOKEN", {
      userEmail: "alice@example.test",
      orgId: "org_123",
      scope: "org",
    });
  });

  it("reads allowlists from the resolved scope", async () => {
    mockReadAppSecretMeta.mockResolvedValue({
      urlAllowlist: ["https://api.github.com"],
    });

    await expect(
      getResolvedKeyAllowlist({
        name: "GITHUB_TOKEN",
        scope: "org",
        scopeId: "org_123",
      }),
    ).resolves.toEqual(["https://api.github.com"]);

    expect(mockReadAppSecretMeta).toHaveBeenCalledWith({
      key: "GITHUB_TOKEN",
      scope: "org",
      scopeId: "org_123",
    });
  });

  it("returns null from getResolvedKeyAllowlist when the key has no allowlist or is missing", async () => {
    mockReadAppSecretMeta.mockResolvedValueOnce({ urlAllowlist: null });
    await expect(
      getResolvedKeyAllowlist({
        name: "GITHUB_TOKEN",
        scope: "org",
        scopeId: "org_123",
      }),
    ).resolves.toBeNull();

    mockReadAppSecretMeta.mockResolvedValueOnce(null);
    await expect(
      getResolvedKeyAllowlist({
        name: "GITHUB_TOKEN",
        scope: "org",
        scopeId: "org_123",
      }),
    ).resolves.toBeNull();
  });
});

describe("resolveKeyReferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AGENT_NATIVE_KEYS_WORKSPACE_FALLBACK;
    mockReadAppSecret.mockResolvedValue(null);
  });

  it("is a no-op when the text contains no ${keys.NAME} placeholders", async () => {
    const result = await resolveKeyReferences(
      "https://example.com/no/placeholders",
      "user",
      "alice@example.test",
    );

    expect(result.resolved).toBe("https://example.com/no/placeholders");
    expect(result.usedKeys).toEqual([]);
    expect(result.secretValues).toEqual([]);
    // No lookup should happen when there's nothing to resolve.
    expect(mockReadAppSecret).not.toHaveBeenCalled();
  });

  it("substitutes a single reference and returns the value for downstream redaction", async () => {
    mockReadAppSecret.mockResolvedValue({ value: "sk-secret-123" });

    const result = await resolveKeyReferences(
      "Authorization: Bearer ${keys.OPENAI_API_KEY}",
      "user",
      "alice@example.test",
    );

    expect(result.resolved).toBe("Authorization: Bearer sk-secret-123");
    // usedKeys carries NAMES (safe to log); secretValues carries the raw
    // value separately so the caller can redact it from any output.
    expect(result.usedKeys).toEqual(["OPENAI_API_KEY"]);
    expect(result.secretValues).toEqual(["sk-secret-123"]);
  });

  it("deduplicates repeated references but substitutes every occurrence", async () => {
    mockReadAppSecret.mockResolvedValue({ value: "tok" });

    const result = await resolveKeyReferences(
      "${keys.K}-${keys.K}-${keys.K}",
      "user",
      "alice@example.test",
    );

    expect(result.resolved).toBe("tok-tok-tok");
    // The key is looked up exactly once even though it appears three times.
    expect(mockReadAppSecret).toHaveBeenCalledTimes(1);
    expect(result.usedKeys).toEqual(["K"]);
    expect(result.secretValues).toEqual(["tok"]);
  });

  it("resolves multiple distinct references", async () => {
    mockReadAppSecret.mockImplementation(async ({ key }) =>
      key === "A" ? { value: "aaa" } : { value: "bbb" },
    );

    const result = await resolveKeyReferences(
      "${keys.A}/${keys.B}",
      "user",
      "alice@example.test",
    );

    expect(result.resolved).toBe("aaa/bbb");
    expect(result.usedKeys).toEqual(["A", "B"]);
    expect(result.secretValues).toEqual(["aaa", "bbb"]);
  });

  it("throws a clear, value-free error when a referenced key is missing", async () => {
    mockReadAppSecret.mockResolvedValue(null);

    await expect(
      resolveKeyReferences(
        "Bearer ${keys.MISSING_KEY}",
        "user",
        "alice@example.test",
      ),
    ).rejects.toThrow(
      /Referenced key "MISSING_KEY" is not defined for scope "user"/,
    );
  });

  it("does NOT fall back to workspace scope by default (audit 05 H2)", async () => {
    // user-scope miss; a workspace row exists but must be ignored unless the
    // opt-in flag is set — this prevents one org member's workspace key from
    // poisoning every other member's ${keys.NAME} resolution.
    mockReadAppSecret.mockImplementation(async ({ scope }) =>
      scope === "workspace" ? { value: "poisoned-workspace-value" } : null,
    );

    await expect(
      resolveKeyReferences(
        "Bearer ${keys.OPENAI_API_KEY}",
        "user",
        "alice@example.test",
      ),
    ).rejects.toThrow(/is not defined for scope "user"/);

    // Only the user scope was queried — the workspace fallback never fired.
    expect(mockReadAppSecret).toHaveBeenCalledTimes(1);
    expect(mockReadAppSecret).toHaveBeenCalledWith({
      key: "OPENAI_API_KEY",
      scope: "user",
      scopeId: "alice@example.test",
    });
  });

  it("falls back to workspace scope only when the opt-in flag is enabled", async () => {
    process.env.AGENT_NATIVE_KEYS_WORKSPACE_FALLBACK = "1";
    mockGetRequestOrgId.mockReturnValue("org_999");
    mockReadAppSecret.mockImplementation(async ({ scope }) =>
      scope === "workspace" ? { value: "shared-default" } : null,
    );

    const result = await resolveKeyReferences(
      "Bearer ${keys.OPENAI_API_KEY}",
      "user",
      "alice@example.test",
    );

    expect(result.resolved).toBe("Bearer shared-default");
    expect(mockReadAppSecret).toHaveBeenCalledWith({
      key: "OPENAI_API_KEY",
      scope: "workspace",
      scopeId: "org_999",
    });
  });

  it("only honors recognized truthy values for the fallback flag", async () => {
    // A non-truthy flag value must keep the fallback OFF.
    process.env.AGENT_NATIVE_KEYS_WORKSPACE_FALLBACK = "0";
    mockReadAppSecret.mockImplementation(async ({ scope }) =>
      scope === "workspace" ? { value: "should-not-be-used" } : null,
    );

    await expect(
      resolveKeyReferences("${keys.K}", "user", "alice@example.test"),
    ).rejects.toThrow(/is not defined/);
    expect(mockReadAppSecret).toHaveBeenCalledTimes(1);
  });
});

describe("validateUrlAllowlist", () => {
  it("is permissive when no allowlist is configured", () => {
    expect(validateUrlAllowlist("https://anything.test/x", null)).toBe(true);
    expect(validateUrlAllowlist("https://anything.test/x", [])).toBe(true);
  });

  it("allows a URL whose origin exactly matches an allowlist entry", () => {
    // Path/query differences are ignored — matching is on origin only.
    expect(
      validateUrlAllowlist("https://hooks.slack.com/services/abc/def", [
        "https://hooks.slack.com",
      ]),
    ).toBe(true);
  });

  it("blocks a URL whose origin is not in the allowlist", () => {
    expect(
      validateUrlAllowlist("https://evil.example.com/steal", [
        "https://hooks.slack.com",
      ]),
    ).toBe(false);
  });

  it("treats scheme and port as part of the origin", () => {
    expect(
      validateUrlAllowlist("http://api.test/x", ["https://api.test"]),
    ).toBe(false);
    expect(
      validateUrlAllowlist("https://api.test:8443/x", ["https://api.test"]),
    ).toBe(false);
  });

  it("returns false for a malformed target URL", () => {
    expect(validateUrlAllowlist("not a url", ["https://api.test"])).toBe(false);
  });

  it("skips malformed allowlist entries but still matches valid ones", () => {
    expect(
      validateUrlAllowlist("https://api.test/x", [
        "::::garbage",
        "https://api.test",
      ]),
    ).toBe(true);
    // When every entry is malformed, nothing matches.
    expect(
      validateUrlAllowlist("https://api.test/x", ["::::garbage", "also bad"]),
    ).toBe(false);
  });
});

describe("getKeyAllowlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AGENT_NATIVE_KEYS_WORKSPACE_FALLBACK;
    mockReadAppSecretMeta.mockResolvedValue(null);
  });

  it("returns the configured allowlist for the requested scope", async () => {
    mockReadAppSecretMeta.mockResolvedValue({
      urlAllowlist: ["https://api.openai.com"],
    });

    await expect(
      getKeyAllowlist("OPENAI_API_KEY", "user", "alice@example.test"),
    ).resolves.toEqual(["https://api.openai.com"]);
  });

  it("returns null when the key exists but has no allowlist", async () => {
    mockReadAppSecretMeta.mockResolvedValue({ urlAllowlist: null });
    await expect(
      getKeyAllowlist("OPENAI_API_KEY", "user", "alice@example.test"),
    ).resolves.toBeNull();
  });

  it("does NOT consult workspace scope by default, mirroring the resolver", async () => {
    mockReadAppSecretMeta.mockImplementation(async ({ scope }) =>
      scope === "workspace"
        ? { urlAllowlist: ["https://workspace.test"] }
        : null,
    );

    await expect(
      getKeyAllowlist("OPENAI_API_KEY", "user", "alice@example.test"),
    ).resolves.toBeNull();
    // Only the user scope was consulted — the allowlist check stays aligned
    // with resolveKeyReferences so we never allow a URL the resolver refuses.
    expect(mockReadAppSecretMeta).toHaveBeenCalledTimes(1);
  });

  it("consults workspace scope only when the opt-in flag is enabled", async () => {
    process.env.AGENT_NATIVE_KEYS_WORKSPACE_FALLBACK = "true";
    mockGetRequestOrgId.mockReturnValue("org_555");
    mockReadAppSecretMeta.mockImplementation(async ({ scope }) =>
      scope === "workspace"
        ? { urlAllowlist: ["https://workspace.test"] }
        : null,
    );

    await expect(
      getKeyAllowlist("OPENAI_API_KEY", "user", "alice@example.test"),
    ).resolves.toEqual(["https://workspace.test"]);
    expect(mockReadAppSecretMeta).toHaveBeenCalledWith({
      key: "OPENAI_API_KEY",
      scope: "workspace",
      scopeId: "org_555",
    });
  });
});
