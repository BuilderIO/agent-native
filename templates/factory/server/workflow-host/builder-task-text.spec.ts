import { BuilderBranchError } from "@agent-native/core/server";
import { describe, expect, it, vi } from "vitest";

import { REPORT_TEXT_MAX_CHARS } from "../lib/builder-task-reports.js";
import { slackHeadline } from "../triage/slack-headline.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import {
  normalizedItemSchema,
  type NormalizedItem,
} from "../workflow/items.js";
import { effectsOf, scenarioRun } from "../workflow/stories/proof-kit.js";
import { STORIES } from "../workflow/stories/registry.js";
import {
  executeBuilderOperation,
  type BuilderOperationDeps,
} from "./builder-operations.js";

// The first live hand-off made Builder a task that named nothing to fix. The
// model that wrote the task was the only thing that carried the report's text
// to Builder, and it left the dialog, the wrong wording and the right one out.
// These specs run the real engine on reports, give the model answers that leave
// their words out, and read what the real start operation sends to Builder.

const STORY = "bug-report-to-builder";
const DIALOG =
  "the-task-carries-the-reports-own-words-whatever-the-model-wrote";
const THREE = "three-reports-of-one-defect-make-one-task-that-names-all-three";
const ALERTS = "security-alert-to-safe-fix";

/** The first of a list a spec needs, or a loud failure naming what was missing. */
function first<T>(list: readonly T[], what: string): T {
  const [found] = list;
  if (found === undefined) throw new Error(`There is no ${what}.`);
  return found;
}

function itemsOf(recording: unknown): NormalizedItem[] {
  if (
    typeof recording !== "object" ||
    recording === null ||
    !("items" in recording) ||
    !Array.isArray(recording.items)
  ) {
    throw new Error("The recording holds no items.");
  }
  return recording.items.map((item) => normalizedItemSchema.parse(item));
}

const feedback = (name: string) =>
  itemsOf(STORIES[STORY].fixtures.inbox.feedback?.[name]);

function builderStart() {
  const operation = OPERATION_CATALOG.get("builder.start");
  if (operation === undefined) throw new Error("builder.start is not there.");
  return operation;
}

/** The real start operation, with Builder and the inbox faked: what it sends is what is read back. */
async function startWith(
  fields: Record<string, unknown>,
  inbox: readonly NormalizedItem[],
) {
  const startAgent = vi.fn(
    async (args: { branchName?: string; prompt?: string }) => ({
      branchName: args.branchName ?? "generated",
      projectId: "project-1",
      url: "https://builder.io/app/projects/project-1/branch/started",
      status: "processing",
    }),
  );
  const getStatus = vi.fn(async () => {
    throw new BuilderBranchError("branch_not_found", "status", "none");
  });
  const readReports = vi.fn(async (ids: readonly string[]) => ({
    ok: true as const,
    reports: ids.flatMap((id) => inbox.filter((report) => report.id === id)),
  }));
  const deps = {
    startAgent,
    getStatus,
    readReports,
    now: () => new Date("2026-10-19T12:00:00.000Z"),
    stuckAfterMs: 30 * 60_000,
  } as unknown as BuilderOperationDeps;
  const result = await executeBuilderOperation({
    operation: builderStart(),
    fields,
    owner: "owner@example.test",
    signal: new AbortController().signal,
    deps,
  });
  expect(result.ok).toBe(true);
  const [call] = startAgent.mock.calls;
  return { sent: String(call?.[0].prompt), readReports };
}

async function startsOf(
  story: "bug-report-to-builder" | "security-alert-to-safe-fix",
  scenario: string,
) {
  const { summary } = await scenarioRun(story, scenario);
  const starts = effectsOf(summary, "builder.start");
  if (starts.length === 0) {
    throw new Error("The scenario never started Builder.");
  }
  return starts.map((start) => start.fields);
}

const idsOf = (fields: Record<string, unknown>) =>
  (fields.reports as { id: string }[]).map((entry) => entry.id);

describe("the task Builder is sent", () => {
  it("carries the report's own words, even when the model's task leaves them out", async () => {
    const fields = first(await startsOf(STORY, DIALOG), "start");
    // What the model wrote, as the graph's recording has it: no dialog, no wording.
    expect(String(fields.prompt)).not.toContain("Delete comment?");
    expect(String(fields.prompt)).not.toContain("deleteCandidate");

    const report = first(feedback("dialogReport"), "report");
    const { sent } = await startWith(fields, [report]);

    // The line that fails when a model is the only carrier of the report.
    expect(sent).toContain(String(report.text));
    expect(sent).toContain("Delete comment?");
    expect(sent).toContain("deleteCandidate");
    // The model's instruction is still there, first.
    expect(sent.startsWith(String(fields.prompt))).toBe(true);
  });

  it("names the report by the headline its first line gives, and says who wrote it and where", async () => {
    const fields = first(await startsOf(STORY, DIALOG), "start");
    const report = first(feedback("dialogReport"), "report");
    // The fixture is what a poll records for this message, not a title written by hand.
    expect(report.title).toBe(slackHeadline(String(report.text)));

    const { sent } = await startWith(fields, [report]);

    expect(sent).toContain(`Report 1 of 1: ${report.title}`);
    expect(sent).toContain("From: Slack user Jordan");
    expect(sent).toContain(`Link: ${report.url}`);
  });

  it("lists all three reports of a group of three, each in its own words, whatever the model wrote", async () => {
    const fields = first(await startsOf(STORY, THREE), "start");
    const reports = feedback("threePayReports");
    expect(idsOf(fields)).toEqual(["p1", "p2", "p3"]);

    const { sent, readReports } = await startWith(fields, reports);

    expect(readReports.mock.calls[0]?.[0]).toEqual(["p1", "p2", "p3"]);
    for (const [index, report] of reports.entries()) {
      expect(sent).toContain(`Report ${index + 1} of 3: ${report.title}`);
      expect(sent).toContain(String(report.text));
      expect(sent).toContain(`Link: ${report.url}`);
    }
  });

  it("starts each group of a run on the reports of that group alone", async () => {
    const starts = await startsOf(STORY, "two-related-reports-become-one-task");
    const reports = feedback("threeReports");

    expect(starts.map(idsOf)).toEqual([["m1", "m2"], ["m3"]]);
    const firstGroup = await startWith(first(starts, "start"), reports);
    expect(firstGroup.sent).toContain("Clicking Pay does nothing.");
    expect(firstGroup.sent).toContain("Nothing happens when I press Pay.");
    expect(firstGroup.sent).not.toContain("The CSV has only the header row.");
  });

  it("cuts a long report at the bound and says so, and keeps the rest of the task", async () => {
    const fields = first(await startsOf(STORY, DIALOG), "start");
    const report = first(feedback("dialogReport"), "report");
    const tail = "THE-END-OF-A-VERY-LONG-REPORT";
    const long = {
      ...report,
      text: `${"a long report, ".repeat(600)}${tail}`,
    };

    const { sent } = await startWith(fields, [long]);

    expect(sent).toContain(`[cut at ${REPORT_TEXT_MAX_CHARS} characters]`);
    expect(sent).not.toContain(tail);
    expect(sent.startsWith(String(fields.prompt))).toBe(true);
    expect(sent).toContain(`Link: ${report.url}`);
  });

  it("carries a security alert's package, manifest and fixed version, though the model's task names none", async () => {
    const start = first(
      await startsOf(ALERTS, "each-alert-lands-where-the-story-says"),
      "start",
    );
    const alerts = itemsOf(
      STORIES[ALERTS].fixtures.provider["github.listSecurityAlerts"]
        ?.mixedBatch,
    );

    const { sent } = await startWith(
      { ...start, prompt: "Upgrade the vulnerable package." },
      alerts,
    );

    expect(start.reports).toBe("alert-101");
    expect(sent.startsWith("Upgrade the vulnerable package.")).toBe(true);
    expect(sent).toContain("Report 1 of 1: lodash: prototype pollution");
    for (const detail of [
      "- package: lodash",
      "- ecosystem: npm",
      "- manifestPath: package.json",
      "- fixedVersion: 4.17.21",
      "- severity: medium",
    ]) {
      expect(sent).toContain(detail);
    }
    expect(sent).toContain("> Advisory text for alert 101.");
    expect(sent).toContain(
      "Link: https://github.example.test/example-org/example-repo/security/dependabot/101",
    );
    // Only this alert, not the others the source offered.
    expect(sent).not.toContain("serialize-javascript");
  });
});
