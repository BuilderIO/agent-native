import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Clips link preview content script", () => {
  it("includes Jira host coverage and Jira issue selectors", () => {
    const source = readFileSync(
      new URL("./github-preview-content.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("issue.views.issue-base.foundation.description");
    expect(source).toContain("ak-renderer-document");
  });

  it("exposes the preview asset on Jira pages", () => {
    const manifest = JSON.parse(
      readFileSync(
        new URL("../public/manifest.json", import.meta.url),
        "utf8",
      ) as string,
    ) as {
      content_scripts?: Array<{ matches?: string[]; js?: string[] }>;
      web_accessible_resources?: Array<{
        resources?: string[];
        matches?: string[];
      }>;
    };

    expect(manifest.content_scripts?.[0]?.matches).toEqual(
      expect.arrayContaining([
        "https://github.com/*",
        "https://*.atlassian.net/*",
        "https://*.jira.com/*",
      ]),
    );
    expect(manifest.content_scripts?.[0]?.js).toEqual([
      "assets/github-preview-content.js",
    ]);
    expect(manifest.web_accessible_resources?.[1]?.matches).toEqual(
      expect.arrayContaining([
        "https://github.com/*",
        "https://*.atlassian.net/*",
        "https://*.jira.com/*",
      ]),
    );
  });
});
