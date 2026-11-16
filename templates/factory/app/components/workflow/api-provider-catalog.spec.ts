import { describe, expect, it } from "vitest";

import {
  curlProvidersOf,
  docsUrlOf,
  type ApiProviderInfo,
} from "./api-provider-catalog";

const catalog: ApiProviderInfo[] = [
  {
    id: "github",
    label: "GitHub",
    defaultBaseUrl: "https://api.github.com",
    docsUrls: ["https://docs.github.com/rest"],
  },
  {
    id: "linear",
    label: "Linear",
    defaultBaseUrl: "https://api.linear.app",
    docsUrls: ["https://linear.app/developers"],
  },
  {
    id: "slack",
    label: "Slack",
    defaultBaseUrl: "https://slack.com/api",
    docsUrls: [
      "javascript:alert(1)",
      "http://api.slack.com/web",
      "https://api.slack.com/web",
    ],
  },
];

describe("curlProvidersOf", () => {
  it("lists the base URL of each provider the step can read and no other", () => {
    expect(curlProvidersOf(catalog, ["github", "slack"])).toEqual([
      { id: "github", baseUrl: "https://api.github.com" },
      { id: "slack", baseUrl: "https://slack.com/api" },
    ]);
    expect(curlProvidersOf(catalog, [])).toEqual([]);
  });
});

describe("docsUrlOf", () => {
  it("is the first docs page that is an https web page", () => {
    expect(docsUrlOf(catalog, "github")).toBe("https://docs.github.com/rest");
    expect(docsUrlOf(catalog, "slack")).toBe("https://api.slack.com/web");
  });

  it("is nothing while the catalog has not loaded, or for a provider it does not list", () => {
    expect(docsUrlOf(undefined, "github")).toBe(undefined);
    expect(docsUrlOf(catalog, "stripe")).toBe(undefined);
  });
});
