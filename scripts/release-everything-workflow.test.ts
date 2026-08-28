import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parse } from "yaml";

type Workflow = Record<string, unknown>;

const workflow = parse(
  readFileSync(".github/workflows/release-everything.yml", "utf8"),
) as Workflow;
const desktopWorkflow = parse(
  readFileSync(".github/workflows/desktop-release.yml", "utf8"),
) as Workflow;
const clipsWorkflow = parse(
  readFileSync(".github/workflows/clips-desktop-release.yml", "utf8"),
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
      contents: "write",
      "pull-requests": "read",
    });
  });

  it("waits for package publication before dispatching stable downstream releases", () => {
    assert.equal(
      coordinator.uses,
      "actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3",
    );
    const source = String((coordinator.with as Workflow).script);
    assert.match(source, /auto-publish\.yml/);
    assert.match(source, /waitForStablePackagePublish/);
    assert.match(source, /Stable package release preparation/);
    assert.match(source, /90 \* 60_000/);
    assert.match(
      source,
      /const coordinatorDeadline = startedAt \+ 350 \* 60_000/,
    );
    assert.match(
      source,
      /Math\.min\(coordinatorDeadline, Date\.now\(\) \+ timeoutMs\)/,
    );
    assert.match(source, /async function getRemoteTagSha\(tag\)/);
    assert.match(source, /github\.rest\.git\.getTag/);
    assert.match(
      source,
      /async function nextStableVersion\(tagPrefix, baseVersion\)/,
    );
    assert.match(source, /github\.paginate\(github\.rest\.repos\.listReleases/);
    assert.match(source, /release\.tag_name\.startsWith\(tagPrefix\)/);
    assert.match(source, /candidate\[2\] \+= 1/);
    assert.match(
      source,
      /async function reserveStableVersion\(tagPrefix, baseVersion, sourceSha\)/,
    );
    assert.match(source, /github\.rest\.git\.createRef/);
    assert.match(source, /refs\/tags\/\$\{tagPrefix\}\$\{version\}/);
    assert.match(source, /error\.status !== 422/);
    assert.match(source, /const reservedTags = new Map\(\)/);
    assert.match(source, /async function cleanupReservedTags\(\)/);
    assert.match(source, /github\.rest\.repos\.deleteRelease/);
    assert.match(source, /github\.rest\.git\.deleteRef/);
    assert.match(source, /await cleanupReservedTags\(\)/);
    assert.match(source, /Downstream workflows own these reserved tags/);
    assert.match(source, /async function getFirstParentSha\(ref\)/);
    assert.match(
      source,
      /const releaseBaseSha = await getFirstParentSha\(releaseSha\)/,
    );
    assert.match(source, /git\.getRef/);
    assert.match(
      source,
      /waitForStablePackagePublish\(releaseSha, packageRef, coreVersionChanged\)/,
    );
    assert.match(source, /readJsonAt\(\s*releaseBaseSha,/);
    assert.match(
      source,
      /initialCorePackage\.version !== corePackage\.version/,
    );
    assert.match(source, /desktop-release\.yml/);
    assert.match(source, /clips-desktop-release\.yml/);
    assert.match(source, /deploy-production-sites-prebuilt\.yml/);
    assert.match(source, /channel: "production"/);
    assert.match(
      source,
      /const packageRef = `@agent-native\/core@\$\{coreVersion\}`/,
    );
    assert.match(
      source,
      /const workflowRef = coreVersionChanged \? packageRef : "main"/,
    );
    assert.match(source, /dispatch\("desktop-release\.yml", workflowRef/);
    assert.match(source, /version: desktopVersion/);
    assert.match(source, /dispatch\("clips-desktop-release\.yml", workflowRef/);
    assert.match(source, /version: clipsVersion/);
    assert.doesNotMatch(
      source,
      /desktopAlreadyPublished|clipsAlreadyPublished/,
    );
    assert.match(source, /source_ref: releaseSha/);
    assert.match(source, /endsWith\("\.agent-native\.com"\)/);
    assert.match(source, /Promise\.allSettled/);
  });

  it("survives auto-publish pending-run replacement", () => {
    const source = String((coordinator.with as Workflow).script);

    assert.match(source, /async function listAutoPublishRuns\(\)/);
    assert.match(source, /async function waitForAutoPublishIdle\(deadline\)/);
    assert.match(source, /listJobsForWorkflowRun/);
    assert.match(source, /wasSupersededPendingRun/);
    assert.match(source, /retryIfSupersededPending/);
    assert.match(
      source,
      /await waitForAutoPublishIdle\(packagePreparationDeadline\)/,
    );
    assert.match(source, /current\.conclusion === "cancelled"/);
    assert.match(
      source,
      /Stable package release preparation did not start before the coordinator timeout/,
    );
  });

  it("checks out the coordinated release commit for desktop builds", () => {
    const desktopSource = JSON.stringify(desktopWorkflow);
    const clipsSource = JSON.stringify(clipsWorkflow);
    const desktopSourceText = readFileSync(
      ".github/workflows/desktop-release.yml",
      "utf8",
    );
    const clipsSourceText = readFileSync(
      ".github/workflows/clips-desktop-release.yml",
      "utf8",
    );
    assert.match(
      desktopSourceText,
      /ref: \$\{\{ inputs\.source_ref \|\| github\.sha \}\}/,
    );
    assert.match(desktopSourceText, /SOURCE_REF,,/);
    assert.match(desktopSourceText, /get_tag_sha\(\)/);
    assert.match(desktopSourceText, /\.draft/);
    assert.match(desktopSourceText, /TAG_SHA[\s\S]*needs\.resolve-version/);
    assert.match(clipsSourceText, /\.draft/);
    assert.match(clipsSourceText, /get_tag_sha\(\)/);
    assert.match(clipsSourceText, /TAG_SHA[\s\S]*RELEASE_SOURCE_REF/);
    assert.match(clipsSourceText, /SOURCE_REF,,/);
    assert.match(desktopSource, /source_ref.*steps\.v\.outputs\.source_ref/);
    assert.match(desktopSource, /full 40-character commit SHA/);
    assert.match(desktopSource, /needs\.resolve-version\.outputs\.source_ref/);
    assert.match(clipsSource, /resolve-source-ref/);
    assert.match(clipsSource, /full 40-character commit SHA/);
    assert.match(clipsSource, /needs\.resolve-source-ref\.outputs\.source_ref/);
    assert.match(clipsSource, /needs\.build-tauri\.outputs\.source_ref/);
    assert.match(desktopSource, /--target \\"\$\{\{ needs\.resolve-version/);
    assert.match(clipsSource, /releaseCommitish/);
  });
});
