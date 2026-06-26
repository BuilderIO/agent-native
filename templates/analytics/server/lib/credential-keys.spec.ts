import { describe, expect, it } from "vitest";

import {
  buildOptionalCredentialKeys,
  credentialProviderConfigs,
  optionalCredentialKeys,
  partitionCredentialUpdate,
  resolveCredentialConfigs,
} from "./credential-keys";

function keysFor(key: string): string[] {
  return resolveCredentialConfigs(key).configs.map((cfg) => cfg.key);
}

describe("credential key lookup", () => {
  it("accepts provider aliases for named source checks", () => {
    expect(keysFor("pylon")).toEqual(["PYLON_API_KEY"]);
    expect(keysFor("jira")).toEqual([
      "JIRA_BASE_URL",
      "JIRA_USER_EMAIL",
      "JIRA_API_TOKEN",
    ]);
    expect(keysFor("bigquery")).toEqual([
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      "BIGQUERY_PROJECT_ID",
    ]);
    expect(keysFor("github")).toEqual(["GITHUB_TOKEN"]);
    expect(keysFor("hubspot")).toEqual([
      "HUBSPOT_PRIVATE_APP_TOKEN",
      "HUBSPOT_ACCESS_TOKEN",
    ]);
    expect(keysFor("google-analytics")).toEqual([
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      "GA4_PROPERTY_ID",
    ]);
  });

  it("still accepts exact credential keys and labels", () => {
    expect(keysFor("JIRA_API_TOKEN")).toEqual(["JIRA_API_TOKEN"]);
    expect(keysFor("Pylon")).toEqual(["PYLON_API_KEY"]);
  });

  it("marks unknown lookups as unknown", () => {
    expect(resolveCredentialConfigs("not-a-source")).toMatchObject({
      configs: [],
      known: false,
    });
  });

  it("describes provider required and optional keys separately", () => {
    expect(
      credentialProviderConfigs.find((cfg) => cfg.provider === "bigquery"),
    ).toMatchObject({
      requiredKeys: [
        "GOOGLE_APPLICATION_CREDENTIALS_JSON",
        "BIGQUERY_PROJECT_ID",
      ],
      optionalKeys: ["ANALYTICS_BIGQUERY_EVENTS_TABLE"],
    });
    expect(
      credentialProviderConfigs.find((cfg) => cfg.provider === "gong"),
    ).toMatchObject({
      requiredKeys: ["GONG_ACCESS_KEY", "GONG_ACCESS_SECRET"],
      optionalKeys: ["GONG_API_BASE"],
    });
    expect(
      credentialProviderConfigs.find((cfg) => cfg.provider === "hubspot"),
    ).toMatchObject({
      requiredKeys: ["HUBSPOT_PRIVATE_APP_TOKEN", "HUBSPOT_ACCESS_TOKEN"],
      requiredMode: "any",
    });
  });
});

describe("optional credential keys", () => {
  it("collects keys that are only ever optional across providers", () => {
    expect(optionalCredentialKeys.has("ANALYTICS_BIGQUERY_EVENTS_TABLE")).toBe(
      true,
    );
    expect(optionalCredentialKeys.has("GONG_API_BASE")).toBe(true);
    expect(optionalCredentialKeys.has("SENTRY_ORG_SLUG")).toBe(true);
    expect(optionalCredentialKeys.has("SENTRY_SERVER_TOKEN")).toBe(true);
    expect(optionalCredentialKeys.has("SLACK_BOT_TOKEN_2")).toBe(true);
  });

  it("never marks a required key as optional, even if listed in another provider's optionalKeys", () => {
    const built = buildOptionalCredentialKeys([
      {
        provider: "primary",
        label: "Primary",
        requiredKeys: ["SHARED_KEY"],
      },
      {
        provider: "secondary",
        label: "Secondary",
        requiredKeys: [],
        optionalKeys: ["SHARED_KEY", "TRULY_OPTIONAL"],
      },
    ]);
    expect(built.has("SHARED_KEY")).toBe(false);
    expect(built.has("TRULY_OPTIONAL")).toBe(true);
  });

  it("does not include keys that are required by any provider", () => {
    expect(
      optionalCredentialKeys.has("GOOGLE_APPLICATION_CREDENTIALS_JSON"),
    ).toBe(false);
    expect(optionalCredentialKeys.has("BIGQUERY_PROJECT_ID")).toBe(false);
    expect(optionalCredentialKeys.has("SENTRY_AUTH_TOKEN")).toBe(false);
  });
});

describe("partitionCredentialUpdate", () => {
  const optional = new Set([
    "ANALYTICS_BIGQUERY_EVENTS_TABLE",
    "GONG_API_BASE",
  ]);

  it("routes blank values for optional keys to toDelete", () => {
    const result = partitionCredentialUpdate(
      [{ key: "ANALYTICS_BIGQUERY_EVENTS_TABLE", value: "" }],
      optional,
    );
    expect(result).toEqual({
      toSave: [],
      toDelete: ["ANALYTICS_BIGQUERY_EVENTS_TABLE"],
      blankRequired: [],
    });
  });

  it("flags blank values for required keys without queueing a delete", () => {
    const result = partitionCredentialUpdate(
      [{ key: "BIGQUERY_PROJECT_ID", value: "" }],
      optional,
    );
    expect(result).toEqual({
      toSave: [],
      toDelete: [],
      blankRequired: ["BIGQUERY_PROJECT_ID"],
    });
  });

  it("trims and saves non-blank values regardless of optional status", () => {
    const result = partitionCredentialUpdate(
      [
        { key: "BIGQUERY_PROJECT_ID", value: "  proj-1  " },
        { key: "GONG_API_BASE", value: "https://api.gong.io/v2" },
      ],
      optional,
    );
    expect(result).toEqual({
      toSave: [
        { key: "BIGQUERY_PROJECT_ID", value: "proj-1" },
        { key: "GONG_API_BASE", value: "https://api.gong.io/v2" },
      ],
      toDelete: [],
      blankRequired: [],
    });
  });

  it("handles a mixed batch (save + clear) in one call", () => {
    const result = partitionCredentialUpdate(
      [
        { key: "BIGQUERY_PROJECT_ID", value: "proj-1" },
        { key: "ANALYTICS_BIGQUERY_EVENTS_TABLE", value: "" },
      ],
      optional,
    );
    expect(result).toEqual({
      toSave: [{ key: "BIGQUERY_PROJECT_ID", value: "proj-1" }],
      toDelete: ["ANALYTICS_BIGQUERY_EVENTS_TABLE"],
      blankRequired: [],
    });
  });

  it("treats whitespace-only values the same as blank", () => {
    const result = partitionCredentialUpdate(
      [{ key: "GONG_API_BASE", value: "   " }],
      optional,
    );
    expect(result.toDelete).toEqual(["GONG_API_BASE"]);
    expect(result.toSave).toEqual([]);
  });
});
