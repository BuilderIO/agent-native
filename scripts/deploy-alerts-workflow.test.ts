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

function slackSteps(job: Workflow): Workflow[] {
  return (job.steps as Workflow[]).filter((step) =>
    String(step.uses).startsWith("slackapi/slack-github-action@"),
  );
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

    it("posts to the QA channel with the QA bot token", () => {
      const [post, ...rest] = slackSteps(report);
      assert.ok(post, "the report job has no Slack step");
      assert.equal(rest.length, 0);
      const inputs = post.with as Record<string, string>;
      assert.equal(inputs.method, "chat.postMessage");
      assert.equal(inputs.token, "${{ secrets.QA_SLACK_BOT_TOKEN }}");
      assert.match(inputs.payload, new RegExp(`channel: ${QA_CHANNEL}`));
    });

    it("lets a failed post fail the run, so an alert that did not send is visible", () => {
      const [post] = slackSteps(report);
      const inputs = post!.with as Record<string, unknown>;
      assert.equal(inputs.errors, undefined);
      assert.equal(post!["continue-on-error"], undefined);
    });
  });

  describe("the reaper", () => {
    const { jobs } = load("deploy-paths-reaper.yml");
    const steps = jobs.reap!.steps as Workflow[];
    const last = steps[steps.length - 1]!;

    it("ends with a Slack post that runs only when an earlier step failed", () => {
      assert.ok(String(last.uses).startsWith("slackapi/slack-github-action@"));
      assert.match(String(last.if), /failure\(\)/);
      assert.match(
        String((last.with as Record<string, string>).payload),
        new RegExp(`channel: ${QA_CHANNEL}`),
      );
    });
  });

  it("does not also email the same failures", () => {
    const { raw } = load("email-workflow-failures.yml");
    assert.doesNotMatch(raw, /Deploy canary/);
    assert.doesNotMatch(raw, /Deploy paths reaper/);
  });
});
