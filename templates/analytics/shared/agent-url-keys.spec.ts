import { scrubLocationState } from "@agent-native/core/client/url-scrub";
import { describe, expect, it } from "vitest";

import { AGENT_URL_QUERY_KEYS, SESSION_FILTER_KEYS } from "./agent-url-keys";

describe("AGENT_URL_QUERY_KEYS", () => {
  it("keeps every filter the agent's view-screen reads and redacts anything else", () => {
    const filters: Record<string, string> = {
      ...Object.fromEntries(SESSION_FILTER_KEYS.map((key) => [key, "v"])),
      event: "pageview",
      noEvent: "signup",
      signal: "rage",
      unused: "design",
      slow: "true",
      f_region: "emea",
      f_dateStart: "2026-01-01",
    };
    const credentials = {
      token: "canary-secret-value",
      access_token: "canary-secret-value",
      "p-key": "canary-secret-value",
      view: "canary-secret-value",
    };
    const search = `?${new URLSearchParams({ ...filters, ...credentials })}`;

    const { searchParams } = scrubLocationState(
      { pathname: "/sessions", search, hash: "" },
      AGENT_URL_QUERY_KEYS,
    );

    expect(searchParams).toMatchObject(filters);
    for (const key of Object.keys(credentials)) {
      expect(searchParams[key]).toBe("<redacted>");
    }
  });
});
