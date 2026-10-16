import { describe, expect, it } from "vitest";

import {
  dbtConnectionReadiness,
  validateEnvironmentId,
  validateSemanticLayerBaseUrl,
} from "./dbt-connection";

describe("dbtConnectionReadiness", () => {
  const ready = {
    status: "connected" as const,
    tokenConfigured: true,
    environmentId: "123456",
  };

  it("is ready only when the row is connected, the token is saved, and the environment ID is set", () => {
    expect(dbtConnectionReadiness(ready)).toBe("ready");
  });

  it("is not ready when a granted connected row has no saved token", () => {
    expect(dbtConnectionReadiness({ ...ready, tokenConfigured: false })).toBe(
      "token_missing",
    );
  });

  it("is not ready when the environment ID is missing", () => {
    expect(dbtConnectionReadiness({ ...ready, environmentId: null })).toBe(
      "environment_missing",
    );
    expect(dbtConnectionReadiness({ ...ready, environmentId: "" })).toBe(
      "environment_missing",
    );
  });

  it("reports no row as not connected, and never as ready", () => {
    expect(
      dbtConnectionReadiness({
        status: null,
        tokenConfigured: true,
        environmentId: "123456",
      }),
    ).toBe("not_connected");
  });

  it("reports a non-digit environment ID as invalid, and trims surrounding whitespace before checking", () => {
    expect(dbtConnectionReadiness({ ...ready, environmentId: "12a" })).toBe(
      "environment_invalid",
    );
    expect(
      dbtConnectionReadiness({ ...ready, environmentId: " 123456 " }),
    ).toBe("ready");
  });

  it("reports a failed token lookup as an error, not as a missing token", () => {
    expect(dbtConnectionReadiness({ ...ready, tokenConfigured: null })).toBe(
      "error",
    );
  });

  it.each([
    ["needs_reauth", "needs_reauth"],
    ["error", "error"],
    ["checking", "checking"],
    ["disabled", "disabled"],
  ] as const)("maps %s status to %s", (status, expected) => {
    expect(dbtConnectionReadiness({ ...ready, status })).toBe(expected);
  });
});

describe("validateEnvironmentId", () => {
  it("accepts digits and trims surrounding whitespace", () => {
    expect(validateEnvironmentId(" 123456 ")).toEqual({
      ok: true,
      value: "123456",
    });
  });

  it.each(["", "12a", "-1", "1.5", "12 34"])("rejects %j", (value) => {
    expect(validateEnvironmentId(value).ok).toBe(false);
  });
});

describe("validateSemanticLayerBaseUrl", () => {
  it.each([
    "https://semantic-layer.cloud.getdbt.com/api/graphql",
    "https://semantic-layer.us1.dbt.com/api/graphql",
    "https://getdbt.com",
  ])("accepts %s", (value) => {
    expect(validateSemanticLayerBaseUrl(value)).toEqual({ ok: true, value });
  });

  it.each([
    "http://semantic-layer.cloud.getdbt.com/api/graphql",
    "https://evilgetdbt.com/api/graphql",
    "https://dbt.com.example.test/api/graphql",
    "https://api.example.test/api/graphql",
    "https://user:pass@semantic-layer.cloud.getdbt.com/api/graphql",
    "semantic-layer.cloud.getdbt.com",
    "",
  ])("rejects %j", (value) => {
    expect(validateSemanticLayerBaseUrl(value).ok).toBe(false);
  });
});
