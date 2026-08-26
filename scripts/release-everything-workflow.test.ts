import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parse } from "yaml";

type Workflow = Record<string, unknown>;

const workflow = parse(
  readFileSync(".github/workflows/release-everything.yml", "utf8"),
) as Workflow;
const trigger = workflow.on as Workflow;
const schedules = trigger.schedule as Workflow[];
const dispatch = trigger.workflow_dispatch as Workflow;
const inputs = dispatch.inputs as Workflow;
const job = (workflow.jobs as Workflow)["release-everything"] as Workflow;
const steps = job.steps as Workflow[];
const coordinator = steps.find(
  (step) =>
    step.name === "Release packages, then desktop apps and production sites",
) as Workflow;

describe("release everything workflow", () => {
  it("runs a DST-aware Monday-Thursday noon Pacific patch release", () => {
    assert.equal(workflow.name, "🚀 Release everything");
    assert.deepEqual(schedules, [
      { cron: "0 12 * * 1-4", timezone: "America/Los_Angeles" },
    ]);
    assert.match(
      String((job.env as Workflow).RELEASE_TYPE),
      /inputs\.releaseType \|\| 'patch'/,
    );
    assert.deepEqual(inputs.releaseType, {
      description: "Stable npm release bump",
      required: true,
      type: "choice",
      options: ["patch", "minor", "major"],
      default: "patch",
    });
    assert.deepEqual(workflow.permissions, {
      actions: "write",
      contents: "read",
      "pull-requests": "read",
    });
  });

  it("waits for package publication before dispatching stable downstream releases", () => {
    assert.equal(
      coordinator.uses,
      "actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b",
    );
    const source = String((coordinator.with as Workflow).script);
    assert.match(source, /auto-publish\.yml/);
    assert.match(source, /waitForStablePackagePublish/);
    assert.match(source, /async function hasRemoteTag\(tag\)/);
    assert.match(source, /git\.getRef/);
    assert.match(
      source,
      /waitForStablePackagePublish\(releaseSha, workflowRef\)/,
    );
    assert.match(source, /Stable npm publication completed without remote tag/);
    assert.match(source, /desktop-release\.yml/);
    assert.match(source, /clips-desktop-release\.yml/);
    assert.match(source, /deploy-production-sites-prebuilt\.yml/);
    assert.match(source, /channel: "production"/);
    assert.match(
      source,
      /const workflowRef = `@agent-native\/core@\$\{coreVersion\}`/,
    );
    assert.match(source, /dispatch\("desktop-release\.yml", workflowRef/);
    assert.match(source, /getReleaseByTag/);
    assert.match(source, /hasCompleteClipsRelease/);
    assert.match(source, /Clips_\$\{version\}_universal\.dmg/);
    assert.match(source, /clipsAlreadyPublished/);
    assert.match(source, /source_ref: releaseSha/);
    assert.match(source, /endsWith\("\.agent-native\.com"\)/);
    assert.match(source, /Promise\.allSettled/);
  });
});
