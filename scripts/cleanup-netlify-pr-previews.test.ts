import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeDeployTargets,
  parseNetlifyDeployIdFromPreviewUrl,
  previewBranchForPullRequest,
  previewDeployTitlePrefix,
  previewEnvironmentForSite,
} from "./cleanup-netlify-pr-previews.ts";

test("parses Netlify preview deploy ids from environment URLs", () => {
  assert.equal(
    parseNetlifyDeployIdFromPreviewUrl(
      "https://6aa3e9d806622328c60f6b62--beta-agent-native-factory.netlify.app",
    ),
    "6aa3e9d806622328c60f6b62",
  );
  assert.equal(parseNetlifyDeployIdFromPreviewUrl(""), null);
  assert.equal(parseNetlifyDeployIdFromPreviewUrl("https://example.com"), null);
});

test("builds stable PR preview identifiers", () => {
  assert.equal(previewBranchForPullRequest(4769), "pr-4769");
  assert.equal(
    previewDeployTitlePrefix(4769),
    "GitHub Actions PR preview #4769 ",
  );
  assert.equal(previewEnvironmentForSite(4769, "factory"), "pr-4769-factory");
});

test("deduplicates deploy targets across collection sources", () => {
  const merged = mergeDeployTargets(
    new Map([
      [
        "site-a:deploy-1",
        {
          deployId: "deploy-1",
          siteId: "site-a",
          siteName: "factory",
          source: "github",
        },
      ],
    ]),
    new Map([
      [
        "site-a:deploy-1",
        {
          deployId: "deploy-1",
          siteId: "site-a",
          siteName: "factory",
          source: "netlify-branch",
        },
      ],
      [
        "site-b:deploy-2",
        {
          deployId: "deploy-2",
          siteId: "site-b",
          siteName: "clips",
          source: "netlify-branch",
        },
      ],
    ]),
  );

  assert.deepEqual(merged, [
    {
      deployId: "deploy-2",
      siteId: "site-b",
      siteName: "clips",
      source: "netlify-branch",
    },
    {
      deployId: "deploy-1",
      siteId: "site-a",
      siteName: "factory",
      source: "netlify-branch",
    },
  ]);
});
