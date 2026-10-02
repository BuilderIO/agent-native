import { describe, expect, it } from "vitest";

import { PERSONAL_PROVIDER_KEYS_RESTRICTED_ERROR_CODE } from "../../server/personal-provider-key-policy.js";
import { LLM_MISSING_CREDENTIALS_ERROR_CODE } from "./credential-errors.js";
import {
  CREDENTIAL_ERROR_CODES,
  credentialStateForErrorCode,
  credentialStateProperties,
  credentialStateTrackingProperties,
  describeChatCredentialState,
  type ChatCredentialInputs,
  type CredentialState,
} from "./credential-state.js";

const monthly = (remaining: number, plan: "free" | "paid" = "paid") => ({
  plan,
  quota: { period: "monthly" as const, remaining },
});

describe("describeChatCredentialState", () => {
  const scenarios: Array<{
    name: string;
    input: ChatCredentialInputs;
    expected: CredentialState;
  }> = [
    {
      name: "org connected, member without a personal key, credits left",
      input: {
        engine: "builder",
        engineUsable: true,
        builderCredits: monthly(40),
      },
      expected: { kind: "usable" },
    },
    {
      // Suallen 9/27: an Enterprise space has an empty wallet and quota left.
      name: "Enterprise org with an empty wallet but quota remaining",
      input: {
        engine: "builder",
        engineUsable: true,
        builderCredits: monthly(18),
      },
      expected: { kind: "usable" },
    },
    {
      name: "org connected and its quota genuinely spent",
      input: {
        engine: "builder",
        engineUsable: true,
        builderCredits: {
          plan: "free",
          quota: { period: "daily", remaining: 0 },
        },
      },
      expected: { kind: "exhausted", period: "daily", plan: "free" },
    },
    {
      // Suallen 9/27 again: "I was able to generate design without any issues".
      name: "chats run on a provider key while the Builder quota is spent",
      input: {
        engine: "anthropic",
        engineUsable: true,
        builderCredits: monthly(0, "free"),
      },
      expected: { kind: "usable" },
    },
    {
      name: "no keys at all",
      input: { engine: "anthropic", engineUsable: false, builderCredits: null },
      expected: { kind: "missing", credential: "provider" },
    },
    {
      name: "Builder picked but its connection cannot run",
      input: { engine: "builder", engineUsable: false, builderCredits: null },
      expected: { kind: "missing", credential: "builder" },
    },
  ];

  it.each(scenarios)("$name", ({ input, expected }) => {
    expect(describeChatCredentialState(input)).toEqual(expected);
  });

  it("never reports an org-connected member's usable Builder chat as exhausted", () => {
    for (const remaining of [0.001, 1, 60]) {
      expect(
        describeChatCredentialState({
          engine: "builder",
          engineUsable: true,
          builderCredits: monthly(remaining),
        }).kind,
      ).toBe("usable");
    }
  });
});

describe("credentialStateForErrorCode", () => {
  it.each([
    [
      LLM_MISSING_CREDENTIALS_ERROR_CODE,
      { kind: "missing", credential: "provider" },
    ],
    ["authentication_error", { kind: "rejected", credential: "provider" }],
    ["HTTP_401", { kind: "rejected", credential: "provider" }],
    ["builder_auth_error", { kind: "rejected", credential: "builder" }],
    // Hosted-agent (A2A) and relay 401s: the same rejected state, not prose.
    ["credential_rejected", { kind: "rejected", credential: "agent" }],
    ["credential_missing", { kind: "missing", credential: "agent" }],
    ["credits-limit-daily", { kind: "exhausted", period: "daily" }],
    ["credits-limit-monthly", { kind: "exhausted", period: "monthly" }],
    ["http_402", { kind: "exhausted" }],
    ["gateway_not_enabled", { kind: "notPermitted", whoCanFix: "org_admin" }],
  ] as const)("%s", (code, expected) => {
    expect(credentialStateForErrorCode(code)).toEqual(expected);
  });

  it("leaves non-credential and absent codes unclassified", () => {
    expect(credentialStateForErrorCode("provider_rate_limited")).toBeNull();
    expect(
      credentialStateForErrorCode("provider_transient_rejection"),
    ).toBeNull();
    expect(credentialStateForErrorCode(undefined)).toBeNull();
    expect(credentialStateForErrorCode("")).toBeNull();
  });

  it("does not read the app's own signed-out 401 as a provider key rejection", () => {
    expect(credentialStateForErrorCode("unauthorized")).toBeNull();
    expect(credentialStateForErrorCode("forbidden")).toBeNull();
  });

  it("tracks the server's personal-key restriction code", () => {
    expect(CREDENTIAL_ERROR_CODES).toHaveProperty(
      PERSONAL_PROVIDER_KEYS_RESTRICTED_ERROR_CODE,
    );
  });
});

describe("credentialStateProperties", () => {
  it("flattens each state into bounded, id-free event properties", () => {
    expect(credentialStateProperties({ kind: "usable" })).toEqual({
      credential_state: "usable",
    });
    expect(
      credentialStateProperties({ kind: "missing", credential: "builder" }),
    ).toEqual({ credential_state: "missing", credential_subject: "builder" });
    expect(
      credentialStateProperties({
        kind: "exhausted",
        period: "daily",
        plan: "free",
      }),
    ).toEqual({ credential_state: "exhausted", credential_period: "daily" });
    expect(
      credentialStateProperties({
        kind: "notPermitted",
        whoCanFix: "org_admin",
      }),
    ).toEqual({
      credential_state: "notPermitted",
      credential_fixer: "org_admin",
    });
  });

  it("maps a wire code to properties and says nothing for a non-credential code", () => {
    expect(credentialStateTrackingProperties("credential_rejected")).toEqual({
      credential_state: "rejected",
      credential_subject: "agent",
    });
    expect(credentialStateTrackingProperties("provider_network_error")).toEqual(
      {},
    );
    expect(credentialStateTrackingProperties(undefined)).toEqual({});
  });
});
