// Renders the two-tab convergence report as a job summary:
//   node --experimental-strip-types e2e/convergence-summary.ts <report.jsonl> [[--required] playwright-report.json...]
// Each Playwright report is one group, headed by its file name. A report after
// --required must exist, read as a Playwright report whose every spec lists
// its tests and every test has a known status, have at least one spec that
// passed, and have no failed spec (ok false, or an unexpected test), or the
// summary exits 1. Any other report that is missing or unreadable is listed
// and never changes the exit status.
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

const [reportPath, ...reportArgs] = process.argv.slice(2);
const playwrightReportPaths: string[] = [];
const requiredReportPaths: string[] = [];
for (let index = 0; index < reportArgs.length; index += 1) {
  const arg = reportArgs[index];
  if (arg !== "--required") {
    playwrightReportPaths.push(arg);
    continue;
  }
  index += 1;
  const required = reportArgs.at(index);
  if (required === undefined || required === "--required") {
    // A dropped report name would otherwise turn a required report optional.
    console.error(
      "Usage: convergence-summary.ts <report.jsonl> [[--required] playwright-report.json...]\n--required must be followed by a report path.",
    );
    process.exit(1);
  }
  playwrightReportPaths.push(required);
  requiredReportPaths.push(required);
}
if (!reportPath || !existsSync(reportPath)) {
  // A missing report means the lane did not run, not that it found nothing.
  console.log(
    `## Content two-tab convergence\n\nNo convergence report was written${reportPath ? ` at \`${reportPath}\`` : ""}, so no scenario was measured.\n`,
  );
  process.exit(1);
}

// The report concatenates every group's records, so a line a known-loss run
// cut short is listed as unreadable rather than failing the summary.
const records: ScenarioRecord[] = [];
const unreadableRecords: string[] = [];
readFileSync(reportPath, "utf8")
  .split("\n")
  .forEach((line, index) => {
    if (!line) return;
    try {
      records.push(JSON.parse(line) as ScenarioRecord);
    } catch (error) {
      unreadableRecords.push(
        `- line ${index + 1}: ${(error as Error).message}`,
      );
    }
  });

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

if (unreadableRecords.length)
  lines.push(
    "",
    "### Unreadable convergence records, not counted",
    "",
    ...unreadableRecords,
  );

const TEST_STATUSES: readonly unknown[] = [
  "expected",
  "unexpected",
  "flaky",
  "skipped",
];
const isTest = (test: unknown): test is PlaywrightTest =>
  typeof test === "object" &&
  test !== null &&
  TEST_STATUSES.includes((test as PlaywrightTest).status);
// A required spec must list its tests: one without them could hide a failure
// the gate never sees.
const isSpec = (spec: unknown, required: boolean): spec is PlaywrightSpec => {
  if (typeof spec !== "object" || spec === null) return false;
  const { title, ok, tags, tests } = spec as PlaywrightSpec;
  return (
    typeof title === "string" &&
    typeof ok === "boolean" &&
    Array.isArray(tags) &&
    (tests === undefined
      ? !required
      : Array.isArray(tests) && tests.every(isTest))
  );
};
// Returns the report's specs, or why it could not be read.
const readReport = (
  file: string,
  required: boolean,
): PlaywrightSpec[] | string => {
  let report: unknown;
  try {
    report = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return `not JSON: ${(error as Error).message}`;
  }
  const specs: PlaywrightSpec[] = [];
  const walk = (suite: unknown): boolean => {
    if (typeof suite !== "object" || suite === null) return false;
    const { specs: suiteSpecs = [], suites = [] } = suite as PlaywrightSuite;
    if (!Array.isArray(suiteSpecs) || !Array.isArray(suites)) return false;
    if (!suiteSpecs.every((spec) => isSpec(spec, required))) return false;
    specs.push(...suiteSpecs);
    return suites.every(walk);
  };
  const suites = (report as { suites?: unknown } | null)?.suites;
  if (!Array.isArray(suites) || !suites.every(walk))
    return "not a Playwright JSON report";
  return specs;
};

// The rendered counts and the required gate both read this, so a summary can't
// list a failure, or no pass, that the exit status ignores. A flaky test passed
// on retry; a spec whose every test was skipped checked nothing.
const outcome = (spec: PlaywrightSpec): "failed" | "skipped" | "passed" => {
  const tests = spec.tests ?? [];
  if (!spec.ok || tests.some((test) => test.status === "unexpected"))
    return "failed";
  return tests.every((test) => test.status === "skipped")
    ? "skipped"
    : "passed";
};

const missing = playwrightReportPaths.filter((file) => !existsSync(file));
const unreadable: string[] = [];
const requiredProblems = requiredReportPaths
  .filter((file) => !existsSync(file))
  .map((file) => `- \`${file}\`: missing, so its tests did not run`);
const reports = playwrightReportPaths.filter(existsSync).flatMap((file) => {
  const required = requiredReportPaths.includes(file);
  const specs = readReport(file, required);
  if (typeof specs === "string") {
    if (required) requiredProblems.push(`- \`${file}\`: ${specs}`);
    else unreadable.push(`- \`${file}\`: ${specs}`);
    return [];
  }
  if (required) {
    if (!specs.some((spec) => outcome(spec) === "passed"))
      requiredProblems.push(`- \`${file}\`: reports no test that passed`);
    const failedTitles = specs
      .filter((spec) => outcome(spec) === "failed")
      .map((spec) => spec.title);
    if (failedTitles.length)
      requiredProblems.push(
        `- \`${file}\`: ${failedTitles.length} failed: ${failedTitles.join("; ")}`,
      );
  }
  // A heading says required only when the gate checks that report.
  const heading = `${basename(file, ".json")}: ${required ? "required" : "not blocking"}`;
  return [{ heading, specs }];
});
const specs = reports.flatMap((report) => report.specs);
const skipReason = (spec: PlaywrightSpec) =>
  (spec.tests ?? [])
    .flatMap((test) => test.annotations ?? [])
    .find((annotation) => annotation.type === "skip")?.description ??
  "no reason given";
if (reports.length) {
  for (const { heading, specs: group } of reports) {
    if (!group.length) continue;
    const failed = group.filter((spec) => outcome(spec) === "failed");
    const skipped = group.filter((spec) => outcome(spec) === "skipped");
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

if (unreadable.length)
  lines.push("", "### Unreadable reports, not blocking", "", ...unreadable);

if (requiredProblems.length)
  lines.push(
    "",
    "### Required reports that fail the check",
    "",
    ...requiredProblems,
  );

console.log(`${lines.join("\n")}\n`);
if (requiredProblems.length) process.exit(1);
