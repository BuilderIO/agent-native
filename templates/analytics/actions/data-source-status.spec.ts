import { describe, expect, it } from "vitest";
import { resolveCredentialConfigs } from "./data-source-status";

function keysFor(key: string): string[] {
  return resolveCredentialConfigs(key).configs.map((cfg) => cfg.key);
}

describe("data-source-status credential lookup", () => {
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
      "ANALYTICS_BIGQUERY_EVENTS_TABLE",
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
});
