import { describe, expect, it } from "vitest";

import {
  validateEnvironmentId,
  validateSemanticLayerBaseUrl,
} from "./dbt-connection";

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
