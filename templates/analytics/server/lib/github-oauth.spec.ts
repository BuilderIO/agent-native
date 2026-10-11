import { afterEach, describe, expect, it, vi } from "vitest";

import { getGitHubOAuthAuthUrl, isGitHubOAuthConfigured } from "./github-oauth";

afterEach(() => vi.unstubAllEnvs());

describe("GitHub integration OAuth configuration", () => {
  it("uses the dedicated integration app credentials", () => {
    vi.stubEnv("GITHUB_INTEGRATION_CLIENT_ID", "integration-client-id");
    vi.stubEnv(
      "GITHUB_INTEGRATION_CLIENT_SECRET",
      "not-a-real-integration-secret",
    );
    vi.stubEnv("GITHUB_CLIENT_ID", "signin-client-id");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "not-a-real-signin-secret");

    const authUrl = new URL(
      getGitHubOAuthAuthUrl(
        "https://analytics.example.test/_agent-native/oauth/github/callback",
        "test-state",
      ),
    );

    expect(authUrl.searchParams.get("client_id")).toBe("integration-client-id");
    expect(isGitHubOAuthConfigured()).toBe(true);
  });

  it("does not treat sign-in app credentials as integration credentials", () => {
    vi.stubEnv("GITHUB_INTEGRATION_CLIENT_ID", "");
    vi.stubEnv("GITHUB_INTEGRATION_CLIENT_SECRET", "");
    vi.stubEnv("GITHUB_CLIENT_ID", "signin-client-id");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "not-a-real-signin-secret");

    expect(isGitHubOAuthConfigured()).toBe(false);
  });
});
