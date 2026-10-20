import { describe, expect, it } from "vitest";

import {
  searchConsolePropertyMessage,
  searchConsolePropertyProblem,
} from "./search-console-property";

describe("searchConsolePropertyProblem", () => {
  it.each([
    "sc-domain:builder.io",
    "sc-domain:agent-native.com",
    "sc-domain:Blog.Example.co.uk",
    "https://www.builder.io/",
    "https://www.builder.io/blog/",
    "http://example.com/",
  ])("accepts %s", (siteUrl) => {
    expect(searchConsolePropertyProblem(siteUrl)).toBeNull();
  });

  it.each([
    ["builder.io", { kind: "bare_domain", suggestion: "sc-domain:builder.io" }],
    [
      "sc-domain:https://www.builder.io/blog/",
      { kind: "invalid_domain", suggestion: "sc-domain:www.builder.io" },
    ],
    [
      "sc-domain:builder.io/blog",
      { kind: "invalid_domain", suggestion: "sc-domain:builder.io" },
    ],
    ["sc-domain:", { kind: "invalid_domain" }],
    ["sc-domain:example.com-", { kind: "invalid_domain" }],
    ["example.com-", { kind: "unrecognized" }],
    ["https://example.com-/", { kind: "unrecognized" }],
    [
      "https://www.builder.io/blog",
      {
        kind: "missing_trailing_slash",
        suggestion: "https://www.builder.io/blog/",
      },
    ],
    ["builder blog", { kind: "unrecognized" }],
    ["https://", { kind: "unrecognized" }],
  ])("explains what's wrong with %s", (siteUrl, problem) => {
    expect(searchConsolePropertyProblem(siteUrl)).toEqual(problem);
  });

  it("names the property to use instead", () => {
    const problem = searchConsolePropertyProblem("builder.io")!;
    expect(searchConsolePropertyMessage("builder.io", problem)).toBe(
      '"builder.io" isn\'t a Search Console property. For a Domain property, use sc-domain:builder.io.',
    );
  });
});
