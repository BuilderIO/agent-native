import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parse } from "yaml";

type Workflow = Record<string, unknown>;

function load(file: string): { jobs: Record<string, Workflow>; raw: string } {
  const raw = readFileSync(`.github/workflows/${file}`, "utf8");
  return {
    jobs: (parse(raw) as Workflow).jobs as Record<string, Workflow>,
    raw,
  };
}

const QA_CHANNEL = "C0C4U4XRT6X";

function steps(job: Workflow): Workflow[] {
  return job.steps as Workflow[];
}

function slackSteps(job: Workflow): Workflow[] {
  return steps(job).filter((step) =>
    String(step.uses).startsWith("slackapi/slack-github-action@"),
  );
}

function retainedReport(job: Workflow, prefix: string): Workflow | undefined {
  return steps(job).find(
    (step) =>
      String(step.uses).startsWith("actions/upload-artifact@") &&
      String((step.with as Record<string, unknown>).name).startsWith(prefix),
  );
}

// What guard-automated-findings.ts requires of a scheduled reporter, plus the
// alert-specific behavior: it names its channel through SLACK_CHANNEL, keeps a
// complete 90-day report, posts after that report exists, and links it.
function assertReporter(job: Workflow, prefix: string): void {
  assert.equal((job.env as Record<string, string>).SLACK_CHANNEL, QA_CHANNEL);

  const [post, ...rest] = slackSteps(job);
  assert.ok(post, "the job has no Slack step");
  assert.equal(rest.length, 0, "a reporter posts one rollup");
  const inputs = post.with as Record<string, unknown>;
  assert.equal(inputs.method, "chat.postMessage");
  assert.equal(inputs.token, "${{ secrets.QA_SLACK_BOT_TOKEN }}");
  assert.match(
    String(inputs.payload),
    /channel: \$\{\{ env\.SLACK_CHANNEL \}\}/,
  );

  const report = retainedReport(job, prefix);
  assert.ok(report, `no ${prefix}* report artifact is uploaded`);
  assert.equal((report.with as Record<string, unknown>)["retention-days"], 90);
  assert.ok(
    steps(job).indexOf(report) < steps(job).indexOf(post),
    "the report is retained before the alert that links it",
  );
  assert.match(
    String(inputs.payload),
    new RegExp(`steps\\.${String(report.id)}\\.outputs\\.artifact-url`),
  );

  // The alert is the point of the job. It must not depend on the report steps
  // before it succeeding (an implicit success() would skip it when the report
  // write or upload failed), and it must still read sensibly with no report.
  assert.match(
    String(post.if),
    /^\$\{\{ (!cancelled\(\)|always\(\)|failure\(\)) \}\}$/,
    "the Slack post is gated on the outcome of earlier steps",
  );
  assert.match(
    String(inputs.payload),
    /artifact-url \|\| '[^']+'/,
    "the message has no fallback for a missing report link",
  );

  // A failed post must fail the run: an alert that did not send is visible.
  assert.equal(inputs.errors, undefined);
  assert.equal(post["continue-on-error"], undefined);
}

describe("deploy-path alerts go to #qa-agent-native", () => {
  describe("the nightly canary", () => {
    const { jobs } = load("deploy-canary.yml");
    const report = jobs.report!;

    it("reports only when a leg failed, and still runs when its needs failed", () => {
      assert.deepEqual(report.needs, ["paths", "hosts"]);
      const condition = String(report.if);
      assert.match(condition, /always\(\)/);
      assert.match(condition, /needs\.paths\.result == 'failure'/);
      assert.match(condition, /needs\.hosts\.result == 'failure'/);
    });

    it("keeps a complete report and links it from one Slack post", () => {
      assertReporter(report, "deploy-canary-report-");
    });

    it("keeps each leg's result files apart, because their names repeat across npm tags", () => {
      const collect = steps(report).find((step) => step.id === "legs");
      const inputs = collect!.with as Record<string, unknown>;
      // merge-multiple flattens every artifact into one directory, so the
      // `nightly` leg's node-npm.json would overwrite the `latest` leg's.
      assert.notEqual(inputs["merge-multiple"], true);
    });

    it("records whether it could collect the legs' result files instead of hiding a failed download", () => {
      const collect = steps(report).find((step) => step.id === "legs");
      assert.ok(collect);
      assert.equal(collect["continue-on-error"], true);
      const write = steps(report).find(
        (step) => step.name === "Write the report",
      );
      assert.match(
        JSON.stringify(write),
        /steps\.legs\.outcome/,
        "the report must say whether the legs' files were collected",
      );
    });
  });

  describe("the reaper", () => {
    const { jobs } = load("deploy-paths-reaper.yml");
    const reap = jobs.reap!;

    it("keeps a complete report and links it from one Slack post", () => {
      assertReporter(reap, "deploy-paths-reaper-report-");
    });

    it("alerts and keeps the report only when a step failed", () => {
      const [post] = slackSteps(reap);
      const report = retainedReport(reap, "deploy-paths-reaper-report-");
      assert.match(String(post!.if), /failure\(\)/);
      assert.match(String(report!.if), /failure\(\)/);
    });
  });

  it("does not also email the same failures", () => {
    const { raw } = load("email-workflow-failures.yml");
    assert.doesNotMatch(raw, /Deploy canary/);
    assert.doesNotMatch(raw, /Deploy paths reaper/);
  });
});
