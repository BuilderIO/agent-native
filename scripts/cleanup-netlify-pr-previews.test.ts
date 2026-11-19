import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanupSiteNames,
  mergeDeployTargets,
  parseClosedWithinHours,
  parseNetlifyDeployIdFromPreviewUrl,
  previewBranchForPullRequest,
  previewDeployTitlePrefix,
  previewEnvironmentForSite,
  selectRecentlyClosedPullRequests,
} from "./cleanup-netlify-pr-previews.ts";
import { previewEligibleSiteNames } from "./netlify-pr-preview-targets.ts";

test("limits PR preview cleanup to the requested eligible app", () => {
  assert.deepEqual(cleanupSiteNames("analytics"), ["analytics"]);
  assert.throws(() => cleanupSiteNames("unknown"), /Ineligible/);
  assert.throws(() => cleanupSiteNames(""), /Ineligible/);
  assert.deepEqual(cleanupSiteNames(), previewEligibleSiteNames());
});

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

test("accepts only a bounded whole-hour sweep window", () => {
  assert.equal(parseClosedWithinHours("3"), 3);
  for (const raw of ["0", "169", "1.5", "-1", "", "3h"]) {
    assert.throws(() => parseClosedWithinHours(raw), /closed-within-hours/);
  }
});

test("sweeps same-repository PRs closed inside the window and stops at the cutoff", () => {
  const cutoffMs = Date.parse("2026-11-19T10:00:00Z");
  const pull = (
    number: number,
    closedAt: string | null,
    updatedAt: string,
    headRepo: string | null = "BuilderIO/agent-native",
  ) => ({
    closed_at: closedAt,
    head: { repo: headRepo === null ? null : { full_name: headRepo } },
    number,
    updated_at: updatedAt,
  });

  const firstPage = selectRecentlyClosedPullRequests(
    [
      pull(1, "2026-11-19T11:00:00Z", "2026-11-19T11:00:00Z"),
      pull(2, "2026-11-19T10:30:00Z", "2026-11-19T10:45:00Z", "someone/fork"),
      pull(3, "2026-11-19T10:20:00Z", "2026-11-19T10:40:00Z", null),
      pull(4, "2026-11-18T08:00:00Z", "2026-11-19T10:30:00Z"),
      pull(5, "2026-11-19T10:00:00Z", "2026-11-19T10:10:00Z"),
    ],
    cutoffMs,
    "builderio/agent-native",
  );
  assert.deepEqual(firstPage, { numbers: [1, 5], reachedCutoff: false });

  const lastPage = selectRecentlyClosedPullRequests(
    [
      pull(6, "2026-11-19T10:05:00Z", "2026-11-19T10:05:00Z"),
      pull(7, "2026-11-19T09:00:00Z", "2026-11-19T09:00:00Z"),
    ],
    cutoffMs,
    "BuilderIO/agent-native",
  );
  assert.deepEqual(lastPage, { numbers: [6], reachedCutoff: true });
  assert.deepEqual(
    selectRecentlyClosedPullRequests([], cutoffMs, "BuilderIO/agent-native"),
    { numbers: [], reachedCutoff: false },
  );
});
