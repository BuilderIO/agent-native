import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveBuilderRequestAuthorizationMock = vi.hoisted(() => vi.fn());

vi.mock("./builder-api-auth.js", () => ({
  resolveBuilderRequestAuthorization: resolveBuilderRequestAuthorizationMock,
}));

vi.mock("./builder-browser.js", () => ({
  getBuilderApiHost: () => "https://api.example.test",
  getBuilderAppHost: () => "https://builder.example.test",
}));

import { getFusionDeploys, pushFusionBranch } from "./fusion-app.js";

describe("Fusion Builder authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses OAuth without legacy API key fields", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "<OAUTH_TOKEN_EXAMPLE>",
      authorization: "Bearer <OAUTH_TOKEN_EXAMPLE>",
      source: "oauth",
      oauthScope: "user",
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await pushFusionBranch({ projectId: "project-1", branchName: "main" });

    expect(resolveBuilderRequestAuthorizationMock).toHaveBeenCalledWith({
      requiredScope: "builder:projects:write",
    });
    const [input, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.searchParams.has("apiKey")).toBe(false);
    expect(url.searchParams.has("userId")).toBe(false);
    expect(init).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer <OAUTH_TOKEN_EXAMPLE>" },
    });
  });

  it("uses the project read scope for deploy listing", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "<OAUTH_TOKEN_EXAMPLE>",
      authorization: "Bearer <OAUTH_TOKEN_EXAMPLE>",
      source: "oauth",
      oauthScope: "user",
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ deploys: [] }), { status: 200 }),
    );

    await expect(getFusionDeploys({ projectId: "project-1" })).resolves.toEqual(
      [],
    );

    expect(resolveBuilderRequestAuthorizationMock).toHaveBeenCalledWith({
      requiredScope: "builder:projects:read",
    });
  });

  it("uses legacy public-key fields when available", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "bpk-example",
      authorization: "Bearer bpk-example",
      source: "legacy",
      legacyPublicKey: "public-key",
      userId: "user-1",
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await pushFusionBranch({ projectId: "project-1", branchName: "main" });

    const [input, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.searchParams.get("apiKey")).toBe("public-key");
    expect(url.searchParams.get("userId")).toBe("user-1");
    expect(init).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer bpk-example" },
    });
  });
});
