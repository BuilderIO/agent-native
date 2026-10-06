// Renders the two-tab convergence report as a job summary:
//   node --experimental-strip-types e2e/convergence-summary.ts <report.jsonl> [playwright-report.json...]
import { existsSync, readFileSync } from "node:fs";

import type { ScenarioRecord, TabRecord } from "./helpers";

type PlaywrightSpec = { title: string; ok: boolean; tags: string[] };
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

const distinct = (record: ScenarioRecord, field: "lost" | "duplicated") =>
  new Set(record.integrity.flatMap((entry) => entry[field])).size;

const lines = [
  "## Content two-tab convergence",
  "",
  `Build \`${records[0]?.build ?? "unknown"}\`, retries off.`,
  "",
  "Edits are typed markers. Lost and duplicated count distinct markers missing or repeated in any observation: the saved page and each tab at the deadline, after a refresh, and in a tab reopened alone.",
  "",
  "| Scenario | Gate | Edits | Lost | Duplicated | Saves | Save answers | Codes | Recovery shown | Error toasts | Editor mounts | Seconds |",
  "| --- | --- | --: | --: | --: | --: | --- | --- | --: | --: | --: | --: |",
];
for (const record of records) {
  const tabs = record.tabs;
  const gate = record.tags.includes(`@${KNOWN_LOSS}`)
    ? "known loss"
    : "required";
  lines.push(
    `| ${record.scenario} | ${gate} | ${record.authoredEdits} | ${distinct(record, "lost")} | ${distinct(record, "duplicated")} | ${sum(tabs, (tab) => tab.saveRequests)} | ${tally(tabs, (tab) => tab.saveOutcomes)} | ${tally(tabs, (tab) => tab.saveCodes)} | ${sum(tabs, (tab) => tab.recovery.length)} | ${sum(tabs, (tab) => tab.errorToasts.length)} | ${sum(tabs, (tab) => tab.editorMounts)} | ${Math.round(record.durationMs / 1000)} |`,
  );
}

const failures = records.flatMap((record) =>
  record.integrity
    .filter((entry) => entry.lost.length || entry.duplicated.length)
    .map(
      (entry) =>
        `- ${record.scenario}, ${entry.at}, ${entry.surface}: lost ${entry.lost.join(" ") || "none"}; duplicated ${entry.duplicated.join(" ") || "none"}`,
    ),
);
if (failures.length)
  lines.push("", "### Lost or duplicated text", "", ...failures);

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

const specs: PlaywrightSpec[] = [];
const missing = playwrightReportPaths.filter((file) => !existsSync(file));
for (const file of playwrightReportPaths.filter(existsSync)) {
  const report = JSON.parse(readFileSync(file, "utf8")) as {
    suites: PlaywrightSuite[];
  };
  const walk = (suite: PlaywrightSuite) => {
    specs.push(...(suite.specs ?? []));
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites) walk(suite);
}
// The JSON report strips the `@` from tags.
const groups = [
  ["Required", specs.filter((spec) => !spec.tags.includes(KNOWN_LOSS))],
  [
    "Known loss, not blocking",
    specs.filter((spec) => spec.tags.includes(KNOWN_LOSS)),
  ],
] as const;
if (playwrightReportPaths.length > missing.length) {
  for (const [heading, group] of groups) {
    const failed = group.filter((spec) => !spec.ok);
    lines.push(
      "",
      `### ${heading}: ${group.length - failed.length} passed, ${failed.length} failed`,
      ...(failed.length
        ? ["", ...failed.map((spec) => `- ${spec.title}`)]
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
