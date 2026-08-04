import { describe, expect, it } from "vitest";

import { isFirstPartyHostedDispatch } from "./hosted-auth";

describe("isFirstPartyHostedDispatch", () => {
  it("enables Google-only auth for canonical production Dispatch", () => {
    expect(
      isFirstPartyHostedDispatch({
        CONTEXT: "production",
        URL: "https://dispatch.agent-native.com",
      }),
    ).toBe(true);
  });

  it("keeps preview and branch deploys password-capable", () => {
    expect(
      isFirstPartyHostedDispatch({
        CONTEXT: "deploy-preview",
        URL: "https://dispatch.agent-native.com",
      }),
    ).toBe(false);
    expect(
      isFirstPartyHostedDispatch({
        CONTEXT: "branch-deploy",
        URL: "https://dispatch.agent-native.com",
      }),
    ).toBe(false);
    expect(
      isFirstPartyHostedDispatch({
        URL: "https://dispatch.agent-native.com",
      }),
    ).toBe(false);
  });

  it("keeps self-hosted and local Dispatch auth unchanged", () => {
    expect(
      isFirstPartyHostedDispatch({
        CONTEXT: "production",
        URL: "https://dispatch.example.com",
      }),
    ).toBe(false);
    expect(
      isFirstPartyHostedDispatch({
        CONTEXT: "production",
        APP_URL: "http://localhost:8080",
      }),
    ).toBe(false);
    expect(isFirstPartyHostedDispatch({})).toBe(false);
  });

  it("honors an explicit public origin before the platform site URL", () => {
    expect(
      isFirstPartyHostedDispatch({
        APP_URL: "https://dispatch.example.com",
        CONTEXT: "production",
        URL: "https://dispatch.agent-native.com",
      }),
    ).toBe(false);
    expect(
      isFirstPartyHostedDispatch({
        BETTER_AUTH_URL: "https://dispatch.example.com",
        CONTEXT: "production",
        URL: "https://dispatch.agent-native.com",
      }),
    ).toBe(false);
  });

  it("rejects malformed and lookalike origins", () => {
    expect(
      isFirstPartyHostedDispatch({ CONTEXT: "production", URL: "not a url" }),
    ).toBe(false);
    expect(
      isFirstPartyHostedDispatch({
        CONTEXT: "production",
        URL: "https://dispatch.agent-native.com.evil.example",
      }),
    ).toBe(false);
  });
});
