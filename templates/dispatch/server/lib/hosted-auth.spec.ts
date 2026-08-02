import { describe, expect, it } from "vitest";

import { isFirstPartyHostedDispatch } from "./hosted-auth";

describe("isFirstPartyHostedDispatch", () => {
  it("enables Google-only auth for the canonical hosted Dispatch origin", () => {
    expect(
      isFirstPartyHostedDispatch({
        URL: "https://dispatch.agent-native.com",
      }),
    ).toBe(true);
  });

  it("keeps self-hosted and local Dispatch auth unchanged", () => {
    expect(
      isFirstPartyHostedDispatch({
        URL: "https://dispatch.example.com",
      }),
    ).toBe(false);
    expect(
      isFirstPartyHostedDispatch({
        APP_URL: "http://localhost:8080",
      }),
    ).toBe(false);
    expect(isFirstPartyHostedDispatch({})).toBe(false);
  });

  it("honors an explicit public origin before the platform site URL", () => {
    expect(
      isFirstPartyHostedDispatch({
        APP_URL: "https://dispatch.example.com",
        URL: "https://dispatch.agent-native.com",
      }),
    ).toBe(false);
  });

  it("rejects malformed and lookalike origins", () => {
    expect(isFirstPartyHostedDispatch({ URL: "not a url" })).toBe(false);
    expect(
      isFirstPartyHostedDispatch({
        URL: "https://dispatch.agent-native.com.evil.example",
      }),
    ).toBe(false);
  });
});
