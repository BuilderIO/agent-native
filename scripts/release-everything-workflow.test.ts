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
    assert.match(
      source,
      /github\.paginate\(github\.rest\.actions\.listJobsForWorkflowRun/,
    );
    assert.match(source, /wasSupersededPendingRun\(current, jobs\)/);
    assert.match(source, /if \(jobs\.length > 0\) return false/);
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

  it("judges stages by the jobs that ran, re-running never-started jobs once", () => {
    const source = String((coordinator.with as Workflow).script);
    const start = source.indexOf("function neverStarted");
    const end = source.indexOf("async function waitForRun", start);
    assert(start >= 0 && end > start);
    type Job = {
      name: string;
      status: string;
      conclusion: string | null;
      steps: unknown[];
    };
    const judgeRun = new Function(
      `${source.slice(start, end)}; return judgeRun;`,
    )() as (
      run: { status: string; conclusion: string | null },
      jobs: Job[],
      gateJob?: string,
    ) => { verdict: string; others: Job[] };

    const ran = [{ name: "Set up job" }];
    const job = (
      name: string,
      conclusion: string | null,
      started = conclusion !== "skipped",
    ): Job => ({
      name,
      status: conclusion ? "completed" : "queued",
      conclusion,
      steps: started ? ran : [],
    });
    const gate = String(
      ((autoPublishWorkflow.jobs as Workflow).release as Workflow).name,
    );
    assert.match(source, new RegExp(`gateJob: "${gate}"`));
    const verdict = (
      run: { status: string; conclusion: string | null },
      jobs: Job[],
      gateJob?: string,
    ) => {
      const result = judgeRun(run, jobs, gateJob);
      return [result.verdict, result.others.map((other) => other.name)];
    };

    // Publication run 37361489204 (10/5): npm published, then the notify job
    // was never acquired by a runner and GitHub failed the run.
    const published = [
      job("Verify stable release merge", "success"),
      job("Publish nightly snapshot", "skipped"),
      job(gate, "success"),
    ];
    assert.deepEqual(
      verdict(
        { status: "completed", conclusion: "failure" },
        [...published, job("Notify downstream repos", "cancelled", false)],
        gate,
      ),
      ["success", ["Notify downstream repos"]],
    );
    assert.deepEqual(
      verdict(
        { status: "in_progress", conclusion: null },
        [...published, job("Notify downstream repos", null, false)],
        gate,
      ),
      ["success", ["Notify downstream repos"]],
    );
    assert.deepEqual(
      verdict(
        { status: "in_progress", conclusion: null },
        [job(gate, null)],
        gate,
      ),
      ["pending", []],
    );
    // Publication run 36763352925 (9/30): the publish job itself failed.
    assert.deepEqual(
      verdict(
        { status: "completed", conclusion: "failure" },
        [job(gate, "failure"), job("Notify downstream repos", "success")],
        gate,
      ),
      ["failure", [gate]],
    );
    assert.deepEqual(
      verdict(
        { status: "completed", conclusion: "cancelled" },
        [
          job(gate, "cancelled", false),
          job("Notify downstream repos", "success"),
        ],
        gate,
      ),
      ["rerun", [gate]],
    );

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
    assert.deepEqual(
      verdict({ status: "completed", conclusion: "cancelled" }, fleet),
      [
        "rerun",
        [
          "design production prebuilt deploy",
          "slides production prebuilt deploy",
        ],
      ],
    );
    assert.deepEqual(
      verdict({ status: "completed", conclusion: "cancelled" }, [
        ...fleet,
        job("docs production prebuilt deploy", "cancelled"),
      ])[0],
      "failure",
    );
    assert.deepEqual(
      verdict({ status: "completed", conclusion: "failure" }, [])[0],
      "failure",
    );
    assert.deepEqual(
      verdict({ status: "completed", conclusion: "success" }, fleet),
      ["success", []],
    );
    assert.deepEqual(verdict({ status: "queued", conclusion: null }, fleet), [
      "pending",
      [],
    ]);

    assert.match(source, /reRunWorkflowFailedJobs/);
    assert.match(source, /verdict === "rerun" && rerunFromAttempt === 0/);
    assert.match(source, /current\.run_attempt <= rerunFromAttempt/);
  });

  it("releases production sites even when npm publication fails", () => {
    const source = String((coordinator.with as Workflow).script);
    assert.match(
      source,
      /try \{\s*await waitForStablePackagePublish\(releaseSha, packageRef, coreVersionChanged\);\s*\} catch \(error\) \{\s*publicationError =/,
    );
    assert.match(
      source,
      /dispatch\("deploy-production-sites-prebuilt\.yml", publicationError \? "main" : workflowRef, \{\s*sites: productionSites\.join\(","\),\s*source_ref: releaseSha,/,
    );
    assert.match(
      source,
      /publicationError\s*\? null\s*: dispatch\("desktop-release\.yml"/,
    );
    assert.match(
      source,
      /publicationError\s*\? null\s*: dispatch\("clips-desktop-release\.yml"/,
    );
    assert.match(source, /\^\[0-9a-f\]\{40\}\$/);
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
