// Renders the two-tab convergence report as a job summary:
//   node --experimental-strip-types e2e/convergence-summary.ts <report.jsonl> [playwright-report.json...]
// Each Playwright report is one group, headed by its file name.
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

import type { ScenarioRecord, TabRecord } from "./helpers";

type PlaywrightTest = {
  status: "expected" | "unexpected" | "flaky" | "skipped";
  annotations?: { type: string; description?: string }[];
};
type PlaywrightSpec = {
  title: string;
  ok: boolean;
  tags: string[];
  tests?: PlaywrightTest[];
};
type PlaywrightSuite = {
  title: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
};

const KNOWN_LOSS = "known-loss";

const [reportPath, ...playwrightReportPaths] = process.argv.slice(2);
if (!reportPath || !existsSync(reportPath)) {
  // A missing report means the lane did not run, not that it found nothing.
  console.log(
    `## Content two-tab convergence\n\nNo convergence report was written${reportPath ? ` at \`${reportPath}\`` : ""}, so no scenario was measured.\n`,
  );
  process.exit(1);
}

const records = readFileSync(reportPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as ScenarioRecord);

const sum = (tabs: TabRecord[], pick: (tab: TabRecord) => number) =>
  tabs.reduce((total, tab) => total + pick(tab), 0);

const tally = (
  tabs: TabRecord[],
  pick: (tab: TabRecord) => Record<string, number | undefined>,
) => {
  const totals: Record<string, number> = {};
  for (const tab of tabs)
    for (const [key, value] of Object.entries(pick(tab)))
      totals[key] = (totals[key] ?? 0) + (value ?? 0);
  return (
    Object.entries(totals)
      .map(([key, value]) => `${key} ${value}`)
      .join(", ") || "none"
  );
};

const answers = (tab: TabRecord) => ({
  ...tab.saveOutcomes,
  ...Object.fromEntries(
    Object.entries(tab.lateSaveOutcomes).map(([outcome, count]) => [
      `late ${outcome}`,
      count,
    ]),
  ),
});

const distinct = (
  record: ScenarioRecord,
  field: "lost" | "duplicated" | "resurrected",
) =>
  record.integrity === null
    ? "stopped"
    : new Set(record.integrity.flatMap((entry) => entry[field])).size;

const arms = [...new Set(records.map((record) => record.gate))];
const lines = [
  "## Content two-tab convergence",
  "",
  `Build \`${records[0]?.build ?? "unknown"}\`, live-body gate ${arms.join(" and ") || "unrecorded"}, retries off.`,
  "",
  "Edits are typed markers. Lost and duplicated count distinct markers missing or repeated in any observation: the saved page and each tab at the deadline, after a refresh, and in a tab reopened alone. Deleted, back counts markers a tab deleted that reappeared in any observation.",
  "",
  "| Scenario | Gate | Edits | Lost | Duplicated | Deleted, back | Saves | Save answers | Codes | Recovery shown | Error toasts | Editor mounts | Seconds |",
  "| --- | --- | --: | --: | --: | --: | --: | --- | --- | --: | --: | --: | --: |",
];
for (const record of records) {
  const tabs = record.tabs;
  const gate = `${record.gate ?? "unrecorded"}, ${record.tags.includes(`@${KNOWN_LOSS}`) ? "known loss" : "required"}`;
  lines.push(
    `| ${record.scenario} | ${gate} | ${record.authoredEdits} | ${distinct(record, "lost")} | ${distinct(record, "duplicated")} | ${distinct(record, "resurrected")} | ${sum(tabs, (tab) => tab.saveRequests)} | ${tally(tabs, answers)} | ${tally(tabs, (tab) => tab.saveCodes)} | ${sum(tabs, (tab) => tab.recovery.length)} | ${sum(tabs, (tab) => tab.errorToasts.length)} | ${sum(tabs, (tab) => tab.editorMounts)} | ${Math.round(record.durationMs / 1000)} |`,
  );
}

const failures = records.flatMap((record) =>
  record.integrity === null
    ? []
    : record.integrity
        .filter(
          (entry) =>
            entry.lost.length ||
            entry.duplicated.length ||
            entry.resurrected.length,
        )
        .map(
          (entry) =>
            `- ${record.scenario}, ${entry.at}, ${entry.surface}: lost ${entry.lost.join(" ") || "none"}; duplicated ${entry.duplicated.join(" ") || "none"}; deleted, back ${entry.resurrected.join(" ") || "none"}`,
        ),
);
if (failures.length)
  lines.push(
    "",
    "### Lost, duplicated or deleted-then-back text",
    "",
    ...failures,
  );

// Its marker counts were never taken, so it is listed rather than counted.
const stopped = records.filter((record) => record.integrity === null);
if (stopped.length)
  lines.push(
    "",
    "### Stopped early, text not counted",
    "",
    ...stopped.map(
      (record) =>
        `- ${record.scenario}: ${(record.stoppedEarly ?? "no reason recorded").replace(/\x1b\[[0-9;]*m/g, "").split("\n")[0]}`,
    ),
  );

const notes = records.filter((record) => Object.keys(record.notes).length);
if (notes.length)
  lines.push(
    "",
    "### Notes",
    "",
    ...notes.map(
      (record) => `- ${record.scenario}: \`${JSON.stringify(record.notes)}\``,
    ),
  );

const missing = playwrightReportPaths.filter((file) => !existsSync(file));
const reports = playwrightReportPaths.filter(existsSync).map((file) => {
  const report = JSON.parse(readFileSync(file, "utf8")) as {
    suites: PlaywrightSuite[];
  };
  const specs: PlaywrightSpec[] = [];
  const walk = (suite: PlaywrightSuite) => {
    specs.push(...(suite.specs ?? []));
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites) walk(suite);
  return { label: basename(file, ".json"), specs };
});
const specs = reports.flatMap((report) => report.specs);
// The JSON report strips the `@` from tags.
const groups = reports
  .flatMap(
    ({ label, specs }) =>
      [
        [
          `${label}: required`,
          specs.filter((spec) => !spec.tags.includes(KNOWN_LOSS)),
        ],
        [
          `${label}: known loss, not blocking`,
          specs.filter((spec) => spec.tags.includes(KNOWN_LOSS)),
        ],
      ] as const,
  )
  .filter(([, group]) => group.length > 0);
// A skipped test reports ok, so it is counted apart: it checked nothing.
const skipReason = (spec: PlaywrightSpec) =>
  spec.tests?.every((test) => test.status === "skipped")
    ? (spec.tests
        .flatMap((test) => test.annotations ?? [])
        .find((annotation) => annotation.type === "skip")?.description ??
      "no reason given")
    : null;
if (reports.length) {
  for (const [heading, group] of groups) {
    const skipped = group.filter((spec) => skipReason(spec) !== null);
    const failed = group.filter((spec) => !spec.ok);
    lines.push(
      "",
      `### ${heading}: ${group.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped`,
      ...(failed.length
        ? ["", ...failed.map((spec) => `- ${spec.title}`)]
        : []),
      ...(skipped.length
        ? [
            "",
            ...skipped.map(
              (spec) => `- skipped: ${spec.title} (${skipReason(spec)})`,
            ),
          ]
        : []),
    );
  }
  lines.push(
    "",
    `${specs.length} tests reported, ${records.length} scenarios recorded.`,
  );
}
if (!playwrightReportPaths.length || missing.length)
  lines.push(
    "",
    `No Playwright report${missing.length ? ` at ${missing.map((file) => `\`${file}\``).join(", ")}` : ""}, so the recorded scenarios may not be every test.`,
  );

console.log(`${lines.join("\n")}\n`);
