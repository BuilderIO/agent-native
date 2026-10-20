import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  BASELINE_REVISION,
  FIXTURE_REVISION,
  SYNTHETIC_CASES,
} from "./benchmark";

const baselineRoot = process.env.ANALYTICS_BASELINE_ROOT?.trim();
if (!baselineRoot) {
  throw new Error("Set ANALYTICS_BASELINE_ROOT to a checkout of the baseline.");
}

const actualRevision = execFileSync(
  "git",
  ["-C", baselineRoot, "rev-parse", "HEAD"],
  { encoding: "utf8" },
).trim();
if (actualRevision !== BASELINE_REVISION) {
  throw new Error(
    `Baseline checkout revision mismatch: expected ${BASELINE_REVISION}.`,
  );
}

const baselineRankerFiles = [
  "templates/analytics/server/lib/analytics-query-catalog.ts",
  "templates/analytics/server/lib/analytics-term-matcher.ts",
];
const baselineRankerChanges = execFileSync(
  "git",
  [
    "-C",
    baselineRoot,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ...baselineRankerFiles,
  ],
  { encoding: "utf8" },
).trim();
if (baselineRankerChanges) {
  throw new Error(
    "Baseline ranker files differ from the pinned commit; use a clean baseline checkout.",
  );
}

const baselineModulePath = path.join(
  baselineRoot,
  "templates/analytics/server/lib/analytics-query-catalog.ts",
);
const { rankAnalyticsQueryCatalog } = await import(
  pathToFileURL(baselineModulePath).href
);

const candidateId = (
  candidate: ReturnType<typeof rankAnalyticsQueryCatalog>[number],
) =>
  candidate.kind === "data-dictionary"
    ? `dictionary:${candidate.id}`
    : `dashboard:${candidate.dashboardId}:${candidate.panelId}`;

const rankings = Object.fromEntries(
  SYNTHETIC_CASES.map((testCase) => [
    testCase.id,
    rankAnalyticsQueryCatalog({
      search: testCase.query,
      dashboards: testCase.dashboards,
      dictionaryEntries: testCase.dictionaryEntries,
      limit: 5,
    }).map(candidateId),
  ]),
);

process.stdout.write(
  `${JSON.stringify(
    {
      baselineRevision: actualRevision,
      fixtureRevision: FIXTURE_REVISION,
      rankings,
    },
    null,
    2,
  )}\n`,
);
