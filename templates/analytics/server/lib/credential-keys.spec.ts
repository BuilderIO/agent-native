import { describe, expect, it } from "vitest";
import {
  credentialProviderConfigs,
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
  });
});
