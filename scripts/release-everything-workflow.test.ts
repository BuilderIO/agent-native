import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parse } from "yaml";

type Workflow = Record<string, unknown>;

const workflow = parse(
  readFileSync(".github/workflows/release-everything.yml", "utf8"),
) as Workflow;
const autoPublishWorkflow = parse(
  readFileSync(".github/workflows/auto-publish.yml", "utf8"),
) as Workflow;
const desktopWorkflow = parse(
  readFileSync(".github/workflows/desktop-release.yml", "utf8"),
) as Workflow;
const clipsWorkflow = parse(
  readFileSync(".github/workflows/clips-desktop-release.yml", "utf8"),
) as Workflow;
const docsWorkflow = parse(
  readFileSync(".github/workflows/deploy-docs-production.yml", "utf8"),
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
  it("runs Monday-Thursday at noon and Friday at 10 AM Pacific", () => {
    assert.equal(workflow.name, "🚀 Release everything");
    assert.deepEqual(schedules, [
      { cron: "0 12 * * 1-4", timezone: "America/Los_Angeles" },
      { cron: "0 10 * * 5", timezone: "America/Los_Angeles" },
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
      checks: "read",
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
    assert.match(source, /deploy-docs-production\.yml/);
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

  it("uses the docs publisher for www instead of the app-site fleet", () => {
    const source = String((coordinator.with as Workflow).script);
    const docsDispatch = (docsWorkflow.on as Workflow)
      .workflow_dispatch as Workflow;
    const docsInputs = docsDispatch.inputs as Workflow;
    const docsJobs = docsWorkflow.jobs as Workflow;
    const verifyStableRelease = docsJobs["verify-stable-release"] as Workflow;
    const pauseDocsBuilds = docsJobs["pause-netlify-builds"] as Workflow;
    const restoreDocsBuilds = docsJobs["restore-netlify-builds"] as Workflow;
    const verifyStep = (verifyStableRelease.steps as Workflow[])[0];
    const verifySource = String((verifyStep.with as Workflow).script);
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;

    assert.match(source, /const docsSite = sitesManifest\.fw/);
    assert.match(source, /docsSite\?\.host !== "www\.agent-native\.com"/);
    assert.match(source, /name !== "fw"/);
    assert.match(
      source,
      /dispatch\("deploy-docs-production\.yml", siteWorkflowRef/,
    );
    assert.match(
      source,
      /waitForRun\(docs, "Agent-Native docs production site", 120 \* 60_000\)/,
    );
    assert.match(
      source,
      /\["Docs site", `\$\{outcomes\[3\]\}: \$\{docsSite\.host\}`\]/,
    );
    assert.deepEqual(docsWorkflow.permissions, {
      contents: "read",
      "pull-requests": "read",
    });
    assert.match(
      String(verifyStableRelease.if),
      /github\.event_name == 'push'.*contains\(github\.event\.head_commit\.message, '\[stable-release\]'\)/,
    );
    assert.deepEqual(verifyStableRelease.permissions, {
      contents: "read",
      "pull-requests": "read",
    });
    assert.doesNotThrow(() => new AsyncFunction(verifySource));
    assert.match(
      verifySource,
      /context\.actor !== "builder-io-integration\[bot\]"/,
    );
    assert.match(verifySource, /commits\/\{commit_sha\}\/pulls/);
    assert.match(verifySource, /pullRequest\.base\?\.ref === "main"/);
    assert.match(
      verifySource,
      /pullRequest\.head\?\.ref === "changeset-release\/main"/,
    );
    assert.match(
      verifySource,
      /pullRequest\.merge_commit_sha === context\.sha/,
    );
    assert.match(
      verifySource,
      /pullRequest\.title\.includes\("\[stable-release\]"\)/,
    );
    assert.match(String(pauseDocsBuilds.needs), /verify-stable-release/);
    assert.match(
      String(pauseDocsBuilds.if),
      /!cancelled\(\).*needs\.verify-stable-release\.outputs\.verified != 'true'/,
    );
    assert.match(
      String(restoreDocsBuilds.if),
      /!cancelled\(\).*needs\.verify-stable-release\.outputs\.verified != 'true'/,
    );
    assert.doesNotMatch(
      String(pauseDocsBuilds.if),
      /needs\.verify-stable-release\.result/,
    );
    assert.doesNotMatch(
      String(restoreDocsBuilds.if),
      /needs\.verify-stable-release\.result/,
    );
    assert.deepEqual(docsInputs, {
      source_ref: {
        description: "Optional exact commit SHA; blank uses the selected ref",
        required: false,
        type: "string",
        default: "",
      },
      smoke: {
        description: "Probe www.agent-native.com after publishing",
        required: true,
        type: "boolean",
        default: true,
      },
    });
  });

  it("recovers only a hosted-runner failure after stable npm publication", () => {
    const source = String((coordinator.with as Workflow).script);
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    const stablePublishStart = source.indexOf(
      "async function waitForStablePackagePublish",
    );
    const failureGate = source.indexOf(
      "await requireRecoverableStablePublishFailure(completed)",
    );
    const packageTagCheck = source.indexOf(
      "const tagSha = await getRemoteTagSha(packageTag)",
    );
    const retryDispatch = source.indexOf(
      "await recoverDownstreamNotification()",
      packageTagCheck,
    );
    const downstreamSettled = source.indexOf(
      "const downstream = await Promise.allSettled",
    );
    const notificationFailure = source.indexOf(
      "if (downstreamNotificationFailureUrl)",
      downstreamSettled,
    );
    const completionLog = source.indexOf("Release everything completed");

    assert.doesNotThrow(() => new AsyncFunction(source));
    assert.match(source, /allowCompletedFailure = false/);
    assert.match(
      source,
      /allowCompletedFailure &&\s*current\.conclusion === "failure"/,
    );
    assert.match(
      source,
      /async function requireRecoverableStablePublishFailure\(run\)/,
    );
    assert.match(source, /Verify stable release merge/);
    assert.match(source, /Prepare or publish stable npm packages/);
    assert.match(source, /Notify downstream repos/);
    assert.match(
      source,
      /The job was not acquired by Runner of type hosted even after multiple attempts/,
    );
    assert.match(source, /annotation\.annotation_level === "failure"/);
    assert.match(source, /async function recoverDownstreamNotification\(\)/);
    assert.match(source, /redispatchDownstream: "true"/);
    assert.match(source, /releaseType: "patch"/);
    assert.match(source, /publish\.conclusion !== "skipped"/);
    assert.match(source, /notify\.conclusion === "success"/);
    assert.match(source, /continuing the desktop and production release/);
    assert.match(source, /downstreamNotificationFailureUrl = recovery\.url/);
    assert.match(
      source,
      /Production releases completed, but downstream package notifications were not delivered/,
    );
    assert.ok(stablePublishStart >= 0);
    assert.ok(failureGate > stablePublishStart);
    assert.ok(packageTagCheck > failureGate);
    assert.ok(retryDispatch > packageTagCheck);
    assert.ok(downstreamSettled >= 0);
    assert.ok(notificationFailure > downstreamSettled);
    assert.ok(completionLog > notificationFailure);
  });

  it("isolates stable auto-publish lanes from nightly pushes", () => {
    const group = String((autoPublishWorkflow.concurrency as Workflow).group);
    assert.match(group, /github\.event_name == 'workflow_dispatch'/);
    assert.match(group, /stable-preparation/);
    assert.match(group, /stable-publication/);
    assert.match(group, /stable-release/);

    const source = String((coordinator.with as Workflow).script);
    assert.match(source, /run\.event === "workflow_dispatch"/);
    assert.match(source, /candidate\.event === run\.event/);
  });

  it("survives auto-publish pending-run replacement", () => {
    const source = String((coordinator.with as Workflow).script);

    assert.match(source, /async function listAutoPublishRuns\(\)/);
    assert.match(source, /actions\.listWorkflowRuns\(\{/);
    assert.match(source, /per_page: 25/);
    assert.doesNotMatch(
      source,
      /github\.paginate\(github\.rest\.actions\.listWorkflowRuns/,
    );
    assert.match(source, /async function waitForAutoPublishIdle\(deadline\)/);
    assert.match(source, /if \(activeRuns\.length === 0\) return true/);
    assert.match(source, /listJobsForWorkflowRun/);
    assert.match(source, /listJobsForWorkflowRun\(\{/);
    assert.match(source, /per_page: 1/);
    assert.doesNotMatch(
      source,
      /github\.paginate\(github\.rest\.actions\.listJobsForWorkflowRun/,
    );
    assert.match(source, /wasSupersededPendingRun/);
    assert.match(source, /retryIfSupersededPending/);
    assert.match(source, /candidate\.id !== run\.id/);
    assert.match(source, /candidate\.event === run\.event/);
    assert.match(source, /candidateCreatedAt >= runCreatedAt/);
    assert.match(source, /candidateCreatedAt <= runUpdatedAt/);
    assert.match(source, /Number\.isFinite\(runCreatedAt\)/);
    assert.match(source, /Math\.min\(pollIntervalMs, remaining\)/);
    assert.match(
      source,
      /await waitForAutoPublishIdle\(packagePreparationDeadline\)/,
    );
    assert.match(source, /Date\.now\(\) >= packagePreparationDeadline/);
    assert.match(source, /current\.conclusion === "cancelled"/);
    assert.doesNotMatch(
      source,
      /Math\.max\(60_000, packagePreparationDeadline - Date\.now\(\)\)/,
    );
    assert.match(
      source,
      /Stable package release preparation dispatch exceeded the coordinator timeout/,
    );
  });

  it("re-runs a stage once when its only failures never ran a step", () => {
    const source = String((coordinator.with as Workflow).script);
    const start = source.indexOf("function neverStartedFailures");
    const end = source.indexOf("async function waitForRun", start);
    assert(start >= 0 && end > start);
    type Job = { name: string; conclusion: string; steps: unknown[] };
    const neverStartedFailures = new Function(
      `${source.slice(start, end)}; return neverStartedFailures;`,
    )() as (jobs: Job[]) => Job[];
    const job = (
      name: string,
      conclusion: string,
      ranSteps = conclusion !== "skipped",
    ): Job => ({ name, conclusion, steps: ranSteps ? [{}] : [] });
    const names = (jobs: Job[]) =>
      neverStartedFailures(jobs).map((failed) => failed.name);

    // Production fleet run 36627218071 (9/29): two site jobs were cancelled
    // while queued after sixteen deployed.
    const fleet = [
      ...Array.from({ length: 16 }, (_, index) =>
        job(`site ${index}`, "success"),
      ),
      job("Beta E2E pre-flight", "skipped"),
      job("design production prebuilt deploy", "cancelled", false),
      job("slides production prebuilt deploy", "cancelled", false),
    ];
    assert.deepEqual(names(fleet), [
      "design production prebuilt deploy",
      "slides production prebuilt deploy",
    ]);
    assert.deepEqual(
      names([...fleet, job("docs production prebuilt deploy", "cancelled")]),
      [],
    );
    assert.deepEqual(
      names([...fleet, job("docs production prebuilt deploy", "failure")]),
      [],
    );
    assert.deepEqual(names([]), []);
    assert.deepEqual(names([job("site", "success")]), []);

    assert.match(
      source,
      /current\.status === "completed" && current\.run_attempt > rerunFromAttempt/,
    );
    assert.match(
      source,
      /const neverStarted = rerunFromAttempt\s*\? \[\]\s*: neverStartedFailures\(await listWorkflowRunJobs\(run\.id\)\)/,
    );
    assert.match(source, /reRunWorkflowFailedJobs/);
    assert.match(source, /rerunFromAttempt = current\.run_attempt/);
  });

  it("judges a re-run stage by its new attempt, not a stale read of the old one", async () => {
    const source = String((coordinator.with as Workflow).script);
    const start = source.indexOf("function neverStartedFailures");
    const end = source.indexOf("const hostedRunnerFailure", start);
    assert(start >= 0 && end > start);
    type Run = {
      run_attempt: number;
      status: string;
      conclusion: string | null;
    };
    const run = (
      run_attempt: number,
      status: string,
      conclusion: string | null = null,
    ): Run => ({ run_attempt, status, conclusion });

    const waitFor = async (reads: Run[]) => {
      let polls = 0;
      let reruns = 0;
      const waitForRun = new Function(
        "getRun",
        "listWorkflowRunJobs",
        "github",
        "core",
        "sleep",
        "phaseDeadline",
        "pollIntervalMs",
        "wasSupersededPendingRun",
        "owner",
        "repo",
        `${source.slice(start, end)}; return waitForRun;`,
      )(
        async () => reads[Math.min(polls++, reads.length - 1)],
        async () => [{ name: "design", conclusion: "cancelled", steps: [] }],
        {
          rest: {
            actions: {
              reRunWorkflowFailedJobs: async () => {
                reruns += 1;
              },
            },
          },
        },
        { info() {}, warning() {} },
        async () => {},
        () => Date.now() + 60_000,
        15_000,
        async () => false,
        "BuilderIO",
        "agent-native",
      ) as (
        run: { id: number; url: string },
        label: string,
        timeoutMs: number,
      ) => Promise<Run>;
      const result = waitForRun(
        { id: 1, url: "run" },
        "Production site fleet",
        60_000,
      );
      return { result, counts: () => ({ polls, reruns }) };
    };

    // The first read triggers the re-run; the next three still return the
    // re-run attempt before GitHub reports the new one.
    const stale = Array.from({ length: 3 }, () =>
      run(1, "completed", "cancelled"),
    );
    const succeeded = await waitFor([
      run(1, "completed", "cancelled"),
      ...stale,
      run(2, "in_progress"),
      run(2, "completed", "success"),
    ]);
    assert.deepEqual(await succeeded.result, run(2, "completed", "success"));
    assert.deepEqual(succeeded.counts(), { polls: 6, reruns: 1 });

    const failed = await waitFor([
      run(1, "completed", "cancelled"),
      ...stale,
      run(2, "queued"),
      run(2, "completed", "failure"),
    ]);
    await assert.rejects(
      failed.result,
      /Production site fleet ended failure after one re-run: run/,
    );
    assert.deepEqual(failed.counts(), { polls: 6, reruns: 1 });
  });

  it("releases production sites even when npm publication fails", () => {
    const source = String((coordinator.with as Workflow).script);
    assert.match(
      source,
      /try \{\s*await waitForStablePackagePublish\(releaseSha, packageRef, coreVersionChanged\);\s*\} catch \(error\) \{\s*publicationError =/,
    );
    assert.match(
      source,
      /const siteWorkflowRef = publicationError \? "main" : workflowRef/,
    );
    assert.match(
      source,
      /dispatch\("deploy-production-sites-prebuilt\.yml", siteWorkflowRef, \{\s*sites: productionSites\.join\(","\),\s*source_ref: releaseSha,/,
    );
    assert.match(
      source,
      /publicationError\s*\? null\s*: dispatch\("desktop-release\.yml"/,
    );
    assert.match(
      source,
      /publicationError\s*\? null\s*: dispatch\("clips-desktop-release\.yml"/,
    );
    assert.match(
      source,
      /!\/\^\[0-9a-f\]\{40\}\$\/\.test\(current\.merge_commit_sha \|\| ""\)/,
    );
    assert.match(
      source,
      /const failures = publicationError \? \[publicationError\.message\] : \[\]/,
    );
    assert.match(
      source,
      /await summary\.write\(\);\s*if \(failures\.length > 0\) \{\s*throw/,
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
