import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parse } from "yaml";

import { RELEASE_COORDINATOR_STEP_NAME } from "./release-coordinator.ts";

type Workflow = Record<string, unknown>;

const workflow = parse(
  readFileSync(".github/workflows/release-everything.yml", "utf8"),
) as Workflow;
const phaseWorkflow = parse(
  readFileSync(".github/workflows/release-everything-phase.yml", "utf8"),
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
const docsFreshnessAction = parse(
  readFileSync(".github/actions/docs-source-freshness/action.yml", "utf8"),
) as Workflow;
const productionWorkflow = parse(
  readFileSync(
    ".github/workflows/deploy-production-sites-prebuilt.yml",
    "utf8",
  ),
) as Workflow;
const trigger = workflow.on as Workflow;
const schedules = trigger.schedule as Workflow[];
const dispatch = trigger.workflow_dispatch as Workflow;
const inputs = dispatch.inputs as Workflow;
const workflowJobs = workflow.jobs as Workflow;
const prepareJob = workflowJobs["prepare-release"] as Workflow;
const postMergeJob = workflowJobs["post-merge-release"] as Workflow;
const notifyFailureJob = workflowJobs["notify-failure"] as Workflow;
const job = (phaseWorkflow.jobs as Workflow).release as Workflow;
const steps = job.steps as Workflow[];
const coordinator = steps.find(
  (step) => step.name === RELEASE_COORDINATOR_STEP_NAME,
) as Workflow;

describe("release everything workflow", () => {
  it("runs Monday-Thursday at noon and Friday at 10 AM Pacific", () => {
    assert.equal(workflow.name, "🚀 Release everything");
    assert.deepEqual(schedules, [
      { cron: "0 12 * * 1-4", timezone: "America/Los_Angeles" },
      { cron: "0 10 * * 5", timezone: "America/Los_Angeles" },
    ]);
    assert.match(
      String((prepareJob.with as Workflow).release_type),
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

  it("gives merge preparation and post-merge work independent runner budgets", () => {
    const phaseInputs = (phaseWorkflow.on as Workflow)
      .workflow_call as Workflow;
    const outputs = phaseInputs.outputs as Workflow;
    const postMergeWith = postMergeJob.with as Workflow;
    const notifySteps = notifyFailureJob.steps as Workflow[];
    const failureError = String((notifySteps[0].env as Workflow).RELEASE_ERROR);
    const slackStep = notifySteps[1];
    const slackFallbackStep = notifySteps[2];
    const source = String((coordinator.with as Workflow).script);

    assert.equal(
      prepareJob.uses,
      "./.github/workflows/release-everything-phase.yml",
    );
    assert.equal(postMergeJob.uses, prepareJob.uses);
    assert.equal(postMergeJob.needs, "prepare-release");
    assert.equal(prepareJob.secrets, undefined);
    assert.equal(postMergeJob.secrets, undefined);
    assert.match(
      String(postMergeWith.release_sha),
      /needs\.prepare-release\.outputs\.release_sha/,
    );
    assert.match(
      String(postMergeWith.release_pr_url),
      /needs\.prepare-release\.outputs\.release_pr_url/,
    );
    assert.match(
      String((outputs.release_sha as Workflow).value),
      /jobs\.release\.outputs\.release_sha/,
    );
    assert.equal(job["timeout-minutes"], 360);
    assert.equal(coordinator["timeout-minutes"], 355);
    assert.match(String((job.env as Workflow).RELEASE_PHASE), /inputs\.phase/);
    assert.match(source, /const releasePhase = process\.env\.RELEASE_PHASE/);
    assert.match(
      source,
      /const coordinatorDeadline = startedAt \+ 350 \* 60_000/,
    );
    assert.match(source, /const deadline = phaseDeadline\(210 \* 60_000\)/);
    assert.doesNotMatch(source, /postMergeReserveMs/);
    assert.match(source, /core\.setOutput\("release_sha", releaseSha\)/);
    assert.match(source, /process\.env\.RELEASE_SHA/);
    assert.match(String(notifyFailureJob.if), /always\(\)/);
    assert.match(
      String(notifyFailureJob.if),
      /post-merge-release\.result == 'failure'/,
    );
    assert.match(failureError, /needs\.prepare-release\.outputs\.error/);
    assert.match(failureError, /needs\.post-merge-release\.outputs\.error/);
    assert.equal(notifySteps[0].id, "build-slack-payload");
    assert.match(String(slackStep.if), /always\(\)/);
    assert.match(
      String(slackStep.if),
      /steps\.build-slack-payload\.outcome == 'success'/,
    );
    assert.match(String(slackFallbackStep.if), /always\(\)/);
    assert.match(
      String(slackFallbackStep.if),
      /steps\.build-slack-payload\.outcome != 'success'/,
    );
    assert.match(
      String(slackFallbackStep.if),
      /steps\.slack\.outputs\.ok != 'true'/,
    );
  });

  it("reconciles ambiguous workflow dispatches without risking duplicate children", async () => {
    const source = String((coordinator.with as Workflow).script);
    const start = source.indexOf("let dispatchSequence = 0;");
    const end = source.indexOf("\n\nasync function getRun", start);
    assert(start >= 0 && end > start);
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    const createDispatch = new AsyncFunction(
      "github",
      "context",
      "owner",
      "repo",
      "apiVersion",
      "core",
      "sleep",
      "pollIntervalMs",
      "releasePhase",
      `${source.slice(start, end)}\nreturn dispatch;`,
    );
    const warnings: string[] = [];
    let acceptedInputs: Workflow | undefined;
    const core = {
      info: () => {},
      warning: (message: string) => warnings.push(message),
    };
    const sleep = async () => {};

    let postAttempts = 0;
    let lookups = 0;
    const acceptedGithub = {
      request: async (_route: string, options: Workflow) => {
        postAttempts += 1;
        acceptedInputs = options.inputs as Workflow;
        throw Object.assign(new Error("Failed to run workflow dispatch"), {
          status: 500,
        });
      },
      rest: {
        actions: {
          listWorkflowRuns: async () => {
            lookups += 1;
            return {
              data: {
                workflow_runs:
                  lookups < 3
                    ? (() => {
                        throw Object.assign(
                          new Error(
                            "Workflow run lookup is temporarily unavailable",
                          ),
                          { status: 503 },
                        );
                      })()
                    : [
                        {
                          id: 123,
                          html_url:
                            "https://github.com/BuilderIO/agent-native/actions/runs/123",
                          event: "workflow_dispatch",
                          head_branch: "main",
                          display_title:
                            "Publish packages [release:456-1-prepare-1]",
                        },
                      ],
              },
            };
          },
        },
      },
    };
    const acceptedDispatch = await createDispatch(
      acceptedGithub,
      { runId: 456, runAttempt: 1 },
      "BuilderIO",
      "agent-native",
      "2026-03-10",
      core,
      sleep,
      15_000,
      "prepare",
    );
    const recovered = await acceptedDispatch("auto-publish.yml", "main", {
      releaseType: "patch",
    });
    assert.deepEqual(recovered, {
      id: 123,
      url: "https://github.com/BuilderIO/agent-native/actions/runs/123",
    });
    assert.equal(postAttempts, 1);
    assert.equal(lookups, 3);
    assert.equal(acceptedInputs?.coordinator_run_id, "456-1-prepare-1");
    assert.match(warnings[0] ?? "", /Recovered auto-publish\.yml/);

    const staleDispatchInputs: Workflow[] = [];
    const staleDispatchGithub = {
      request: async (_route: string, options: Workflow) => {
        staleDispatchInputs.push(options.inputs as Workflow);
        throw Object.assign(new Error("GitHub dispatch response failed"), {
          status: 500,
        });
      },
      rest: {
        actions: {
          listWorkflowRuns: async () => ({
            data: {
              workflow_runs: [
                {
                  id: 123,
                  html_url:
                    "https://github.com/BuilderIO/agent-native/actions/runs/123",
                  event: "workflow_dispatch",
                  head_branch: "main",
                  display_title: "Publish packages [release:456-1-prepare-1]",
                },
              ],
            },
          }),
        },
      },
    };
    const postMergeDispatch = await createDispatch(
      staleDispatchGithub,
      { runId: 456, runAttempt: 1 },
      "BuilderIO",
      "agent-native",
      "2026-03-10",
      core,
      sleep,
      15_000,
      "post-merge",
    );
    await assert.rejects(
      postMergeDispatch("auto-publish.yml", "main", {
        redispatchDownstream: "true",
      }),
      /No matching run appeared after 5 lookups/,
    );
    assert.deepEqual(
      staleDispatchInputs.map((inputs) => inputs.coordinator_run_id),
      ["456-1-post-merge-1"],
    );

    const requestInputs: Workflow[] = [];
    let ambiguousPostAttempts = 0;
    const ambiguousGithub = {
      request: async (_route: string, options: Workflow) => {
        ambiguousPostAttempts += 1;
        requestInputs.push(options.inputs as Workflow);
        throw Object.assign(new Error("GitHub is temporarily unavailable"), {
          status: 503,
        });
      },
      rest: {
        actions: {
          listWorkflowRuns: async () => ({ data: { workflow_runs: [] } }),
        },
      },
    };
    const ambiguousDispatch = await createDispatch(
      ambiguousGithub,
      { runId: 456, runAttempt: 2 },
      "BuilderIO",
      "agent-native",
      "2026-03-10",
      core,
      sleep,
      15_000,
      "post-merge",
    );
    await assert.rejects(
      ambiguousDispatch("deploy-docs-production.yml", "main", {
        source_ref: "a".repeat(40),
        smoke: "true",
      }),
      (error: Error) => {
        assert.match(error.message, /GitHub is temporarily unavailable/);
        assert.match(error.message, /does not prove the dispatch was rejected/);
        assert.match(error.message, /\[release:456-2-post-merge-1\]/);
        return true;
      },
    );
    assert.equal(ambiguousPostAttempts, 1);
    assert.deepEqual(
      requestInputs.map((inputs) => inputs.coordinator_run_id),
      ["456-2-post-merge-1"],
    );

    let failedLookupCalls = 0;
    const failedReconciliationGithub = {
      request: async () => {
        throw Object.assign(new Error("GitHub dispatch returned 502"), {
          status: 502,
        });
      },
      rest: {
        actions: {
          listWorkflowRuns: async () => {
            failedLookupCalls += 1;
            throw Object.assign(new Error("Run listing returned 503"), {
              status: 503,
            });
          },
        },
      },
    };
    const failedReconciliationDispatch = await createDispatch(
      failedReconciliationGithub,
      { runId: 456, runAttempt: 2 },
      "BuilderIO",
      "agent-native",
      "2026-03-10",
      core,
      sleep,
      15_000,
    );
    await assert.rejects(
      failedReconciliationDispatch("deploy-docs-production.yml", "main", {}),
      (error: Error) => {
        assert.match(error.message, /GitHub dispatch returned 502/);
        assert.match(error.message, /Run reconciliation failed 5\/5 times/);
        assert.match(error.message, /Run listing returned 503/);
        return true;
      },
    );
    assert.equal(failedLookupCalls, 5);

    let invalidStatusLookups = 0;
    const invalidGithub = {
      request: async () => {
        throw Object.assign(new Error("Validation failed"), { status: 422 });
      },
      rest: {
        actions: {
          listWorkflowRuns: async () => {
            invalidStatusLookups += 1;
            return { data: { workflow_runs: [] } };
          },
        },
      },
    };
    const invalidDispatch = await createDispatch(
      invalidGithub,
      { runId: 456, runAttempt: 1 },
      "BuilderIO",
      "agent-native",
      "2026-03-10",
      core,
      sleep,
      15_000,
    );
    await assert.rejects(
      invalidDispatch("deploy-docs-production.yml", "main", {}),
      /Validation failed/,
    );
    assert.equal(invalidStatusLookups, 0);
  });

  it("waits for accepted sibling releases when one dispatch is unconfirmed", async () => {
    const source = String((coordinator.with as Workflow).script);
    const fanoutStart = source.indexOf(
      "const downstream = await Promise.allSettled([",
    );
    const fanoutEnd = source.indexOf("]);", fanoutStart);
    assert(fanoutStart >= 0 && fanoutEnd > fanoutStart);
    const fanout = source.slice(fanoutStart, fanoutEnd);
    assert.equal((fanout.match(/dispatchAndWait\(/g) ?? []).length, 3);
    assert.match(fanout, /dispatchDocsAndReconcile\(\)/);
    assert(
      source.indexOf("async function dispatchDocsAndReconcile()") < fanoutStart,
    );

    const helperStart = source.indexOf("async function dispatchAndWait(");
    const helperEnd = source.indexOf(
      "\n\nasync function listAutoPublishRuns",
      helperStart,
    );
    assert(helperStart >= 0 && helperEnd > helperStart);
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    const createDispatchAndWait = new AsyncFunction(
      "dispatch",
      "waitForRun",
      `${source.slice(helperStart, helperEnd)}\nreturn dispatchAndWait;`,
    ) as (
      dispatch: (
        workflow: string,
        ref: string,
        inputs: Workflow,
      ) => Promise<{ id: number; url: string }>,
      waitForRun: (
        run: { id: number; url: string },
        label: string,
        timeoutMs: number,
      ) => Promise<void>,
    ) => (
      workflow: string,
      ref: string,
      inputs: Workflow,
      label: string,
      timeoutMs: number,
    ) => Promise<{
      run: { id: number; url: string };
      error: unknown;
    }>;
    const waits: number[] = [];
    const dispatchAndWait = await createDispatchAndWait(
      async (workflow) => {
        if (workflow === "unconfirmed.yml") {
          throw new Error("Could not confirm sibling dispatch");
        }
        const id = Number(workflow.match(/child-(\d)/)?.[1]);
        return { id, url: `https://example.test/runs/${id}` };
      },
      async (run) => {
        waits.push(run.id);
        if (run.id === 2) throw new Error("sibling run failed");
      },
    );
    const settled = await Promise.allSettled([
      dispatchAndWait(
        "unconfirmed.yml",
        "main",
        {},
        "Unconfirmed child",
        60_000,
      ),
      ...[1, 2, 3].map((id) =>
        dispatchAndWait(`child-${id}.yml`, "main", {}, `Child ${id}`, 60_000),
      ),
    ]);

    assert.deepEqual(
      settled.map((result) => result.status),
      ["rejected", "fulfilled", "fulfilled", "fulfilled"],
    );
    assert.deepEqual(waits, [1, 2, 3]);
    const failedSibling = settled[2];
    assert.equal(failedSibling.status, "fulfilled");
    if (failedSibling.status === "fulfilled") {
      assert.equal(failedSibling.value.run.id, 2);
      assert.match(String(failedSibling.value.error), /sibling run failed/);
    }
  });

  it("starts docs push reconciliation before sibling releases settle", async () => {
    const source = String((coordinator.with as Workflow).script);
    const helperStart = source.indexOf("let reconciledDocsRun = null;");
    const fanoutStart = source.indexOf(
      "const downstream = await Promise.allSettled([",
      helperStart,
    );
    assert(helperStart >= 0 && fanoutStart > helperStart);
    const fanoutEnd = source.indexOf("]);", fanoutStart);
    assert(fanoutEnd > fanoutStart);
    const fanout = source.slice(fanoutStart, fanoutEnd);
    assert.match(fanout, /dispatchDocsAndReconcile\(\)/);
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    const createFanout = new AsyncFunction(
      "dispatchAndWait",
      "findSuccessfulDocsPushDeployment",
      "core",
      "siteWorkflowRef",
      "releaseSha",
      "workflowRef",
      "desktopVersion",
      "clipsVersion",
      "productionSites",
      "publicationError",
      `${source.slice(helperStart, fanoutEnd + "]);".length)}
return { downstream, getReconciledDocsRun: () => reconciledDocsRun };`,
    ) as (
      dispatchAndWait: (
        workflow: string,
        ref: string,
        inputs: Workflow,
        label: string,
        timeoutMs: number,
      ) => Promise<Workflow>,
      findSuccessfulDocsPushDeployment: () => Promise<Workflow | null>,
      core: { warning: (message: string) => void },
      siteWorkflowRef: string,
      releaseSha: string,
      workflowRef: string,
      desktopVersion: string,
      clipsVersion: string,
      productionSites: string[],
      publicationError: Error | null,
    ) => Promise<{
      downstream: PromiseSettledResult<Workflow>[];
      getReconciledDocsRun: () => Workflow | null;
    }>;

    const reconciledRun = {
      id: 42,
      url: "https://github.com/BuilderIO/agent-native/actions/runs/42",
    };
    const siblingWorkflows: string[] = [];
    const releaseSiblingWaits: (() => void)[] = [];
    let siblingWaitsFinished = false;
    let siblingCountAtReconciliation = -1;
    let siblingsFinishedAtReconciliation = true;
    let markReconciliationStarted!: () => void;
    const reconciliationStarted = new Promise<void>((resolve) => {
      markReconciliationStarted = resolve;
    });
    const fanoutPromise = createFanout(
      async (workflow) => {
        if (workflow === "deploy-docs-production.yml") {
          return {
            run: {
              id: 43,
              url: "https://github.com/BuilderIO/agent-native/actions/runs/43",
            },
            error: new Error("docs workflow_dispatch failed"),
          };
        }
        const siblingId = siblingWorkflows.length + 1;
        siblingWorkflows.push(workflow);
        return new Promise<Workflow>((resolve) => {
          releaseSiblingWaits.push(() =>
            resolve({
              run: {
                id: siblingId,
                url: `https://github.com/BuilderIO/agent-native/actions/runs/${siblingId}`,
              },
              error: null,
            }),
          );
        });
      },
      async () => {
        siblingCountAtReconciliation = siblingWorkflows.length;
        siblingsFinishedAtReconciliation = siblingWaitsFinished;
        markReconciliationStarted();
        return reconciledRun;
      },
      { warning: () => {} },
      "main",
      "release-sha",
      "v1.2.3",
      "1.2.3",
      "1.2.3",
      ["chat", "design"],
      null,
    );

    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      reconciliationStarted,
      new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          timedOut = true;
          resolve();
        }, 100);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    siblingWaitsFinished = true;
    for (const release of releaseSiblingWaits) release();
    const { downstream, getReconciledDocsRun } = await fanoutPromise;

    assert.equal(timedOut, false);
    assert.deepEqual(siblingWorkflows, [
      "desktop-release.yml",
      "clips-desktop-release.yml",
      "deploy-production-sites-prebuilt.yml",
    ]);
    assert.equal(siblingCountAtReconciliation, 3);
    assert.equal(siblingsFinishedAtReconciliation, false);
    assert.equal(getReconciledDocsRun(), reconciledRun);
    assert.equal(downstream.length, 4);
    const docsResult = downstream[3];
    assert.equal(docsResult.status, "fulfilled");
    if (docsResult.status === "fulfilled") {
      assert.deepEqual(docsResult.value, { run: reconciledRun, error: null });
    }
  });

  it("adds correlation inputs and run titles to coordinated child workflows", () => {
    for (const child of [
      autoPublishWorkflow,
      desktopWorkflow,
      clipsWorkflow,
      productionWorkflow,
      docsWorkflow,
    ]) {
      const childDispatch = (child.on as Workflow)
        .workflow_dispatch as Workflow;
      const childInputs = childDispatch.inputs as Workflow;
      const coordinatorRunId = childInputs.coordinator_run_id as Workflow;
      assert.equal(coordinatorRunId.required, false);
      assert.equal(coordinatorRunId.type, "string");
      assert.equal(coordinatorRunId.default, "");
      assert.match(String(child["run-name"]), /coordinator_run_id/);
    }
    const source = String((coordinator.with as Workflow).script);
    assert.match(source, /coordinator_run_id: coordinatorRunId/);
    assert.match(
      source,
      /run\.display_title\?\.includes\(`\[release:\$\{coordinatorRunId\}\]`\)/,
    );
    assert.match(source, /run\.head_branch === ref/);
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
    assert.match(
      source,
      /async function waitForReleaseMerge\(pr\)[\s\S]*?const deadline = phaseDeadline\(210 \* 60_000\)/,
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
    assert.match(
      source,
      /dispatchAndWait\(\s*"desktop-release\.yml",\s*workflowRef/,
    );
    assert.match(source, /version: desktopVersion/);
    assert.match(
      source,
      /dispatchAndWait\(\s*"clips-desktop-release\.yml",\s*workflowRef/,
    );
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
    const freshnessActionSteps = (docsFreshnessAction.runs as Workflow)
      .steps as Workflow[];
    const freshnessActionScript = String(
      (freshnessActionSteps[0].with as Workflow).script,
    );
    const verifyStableRelease = docsJobs["verify-stable-release"] as Workflow;
    const docsSourceFreshness = docsJobs["docs-source-freshness"] as Workflow;
    const migrateDocs = docsJobs.migrate as Workflow;
    const deployDocs = docsJobs.deploy as Workflow;
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
    assert.match(source, /async function findSuccessfulDocsPushDeployment\(\)/);
    assert.match(
      source,
      /docs production prebuilt deploy \/ production fw prebuilt deploy/,
    );
    assert.match(source, /docsSourceHasCurrentInputs\(sourceSha, mainSha\)/);
    assert.match(source, /index === 3 && reconciledDocsRun/);
    const readPaths = (text: string, declaration: string) => {
      const start = text.indexOf(`const ${declaration} = [`);
      const arrayStart = text.indexOf("[", start);
      const arrayEnd = text.indexOf("];", arrayStart) + 1;
      assert(start >= 0 && arrayEnd > arrayStart);
      return new Function(
        `return ${text.slice(arrayStart, arrayEnd)};`,
      )() as string[];
    };
    assert.deepEqual(
      readPaths(source, "docsDeploymentPaths"),
      readPaths(freshnessActionScript, "docsPaths"),
    );
    const docsDeploymentPaths = readPaths(source, "docsDeploymentPaths");
    assert.deepEqual(
      ((docsWorkflow.on as Workflow).push as Workflow).paths,
      docsDeploymentPaths,
    );
    assert.ok(
      [
        "scripts/netlify-prebuilt-build.ts",
        "scripts/netlify-api-error.ts",
        "scripts/check-function-size-baseline.mjs",
        "scripts/ssr-boot-smoke.mjs",
        "scripts/check-production-cache-contract.mjs",
      ].every((file) => docsDeploymentPaths.includes(file)),
    );
    assert.match(
      source,
      /dispatchAndWait\(\s*"deploy-docs-production\.yml",\s*siteWorkflowRef/,
    );
    assert.match(
      source,
      /"Agent-Native docs production site",\s*120 \* 60_000/,
    );
    assert.match(
      source,
      /\["Docs site", `\$\{outcomes\[3\]\}: \$\{docsSite\.host\}`\]/,
    );
    assert.deepEqual(docsWorkflow.permissions, {
      contents: "read",
      "pull-requests": "read",
    });
    assert.deepEqual(docsWorkflow.concurrency, {
      group: "agent-native-docs-production",
      "cancel-in-progress": false,
      queue: "max",
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
      /!cancelled\(\).*needs\.verify-stable-release\.result == 'skipped'.*needs\.verify-stable-release\.result == 'success'.*needs\.verify-stable-release\.outputs\.verified == 'false'/,
    );
    assert.deepEqual(docsSourceFreshness.needs, ["verify-stable-release"]);
    assert.deepEqual(pauseDocsBuilds.needs, [
      "verify-stable-release",
      "docs-source-freshness",
    ]);
    assert.deepEqual(migrateDocs.needs, [
      "verify-stable-release",
      "docs-source-freshness",
      "pause-netlify-builds",
    ]);
    assert.deepEqual(deployDocs.needs, [
      "verify-stable-release",
      "docs-source-freshness",
      "pause-netlify-builds",
      "migrate",
    ]);
    for (const docsJob of [pauseDocsBuilds, migrateDocs, deployDocs]) {
      assert.match(
        String(docsJob.if),
        /needs\.docs-source-freshness\.result == 'success'/,
      );
      assert.match(
        String(docsJob.if),
        /needs\.docs-source-freshness\.outputs\.current == 'true'/,
      );
    }
    assert.match(
      String(migrateDocs.if),
      /always\(\).*needs\.verify-stable-release\.result == 'skipped'.*needs\.verify-stable-release\.result == 'success'.*needs\.verify-stable-release\.outputs\.verified == 'false'.*needs\.pause-netlify-builds\.result == 'success'/,
    );
    assert.match(
      String(deployDocs.if),
      /always\(\).*needs\.verify-stable-release\.result == 'skipped'.*needs\.verify-stable-release\.result == 'success'.*needs\.verify-stable-release\.outputs\.verified == 'false'.*needs\.pause-netlify-builds\.result == 'success'.*needs\.migrate\.result == 'success'/,
    );
    assert.match(
      String(restoreDocsBuilds.if),
      /!cancelled\(\).*needs\.verify-stable-release\.result == 'skipped'.*needs\.verify-stable-release\.result == 'success'.*needs\.verify-stable-release\.outputs\.verified == 'false'/,
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
      coordinator_run_id: {
        description:
          "Release coordinator ID used to reconcile a transient dispatch failure",
        required: false,
        type: "string",
        default: "",
      },
    });
  });

  it("reconciles a failed docs dispatch against a current successful main deployment", async () => {
    const source = String((coordinator.with as Workflow).script);
    const helperStart = source.indexOf("const docsDeploymentPaths = [");
    const helperEnd = source.indexOf(
      '\n\nif (process.env.RELEASE_PHASE === "prepare")',
      helperStart,
    );
    assert(helperStart >= 0 && helperEnd > helperStart);
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    const createHelpers = new AsyncFunction(
      "github",
      "owner",
      "repo",
      "core",
      "phaseDeadline",
      "sleep",
      "pollIntervalMs",
      "dispatchReconciliationPolls",
      `${source.slice(helperStart, helperEnd)}
return { docsSourceHasCurrentInputs, findSuccessfulDocsPushDeployment };`,
    ) as (
      github: Workflow,
      owner: string,
      repo: string,
      core: { warning: (message: string) => void },
      phaseDeadline: (timeoutMs: number) => number,
      sleep: (ms: number) => Promise<void>,
      pollIntervalMs: number,
      dispatchReconciliationPolls: number,
    ) => Promise<{
      docsSourceHasCurrentInputs: (
        sourceSha: string,
        mainSha: string,
      ) => Promise<boolean>;
      findSuccessfulDocsPushDeployment: () => Promise<{
        id: number;
        url: string;
      } | null>;
    }>;
    const mainSha = "a".repeat(40);
    const run = {
      id: 42,
      html_url: "https://github.com/BuilderIO/agent-native/actions/runs/42",
      head_sha: mainSha,
      head_branch: "main",
      event: "push",
      status: "completed",
      conclusion: "success",
    };
    const successfulDeploy = {
      name: "docs production prebuilt deploy / production fw prebuilt deploy",
      conclusion: "success",
    };
    const createGithub = (
      candidate: Workflow,
      jobs: Workflow[],
      comparison?: Workflow,
      readRuns: () => Workflow[] = () => [candidate],
      onCompare: () => void = () => {},
    ) =>
      ({
        rest: {
          git: {
            getRef: async () => ({ data: { object: { sha: mainSha } } }),
          },
          actions: {
            listWorkflowRuns: async () => ({
              data: { workflow_runs: readRuns() },
            }),
            listJobsForWorkflowRun: async () => ({
              data: { jobs, total_count: jobs.length },
            }),
          },
          repos: {
            compareCommits: async () => {
              onCompare();
              return { data: comparison };
            },
          },
        },
      }) as Workflow;
    const runHelpers = async (
      candidate: Workflow,
      jobs: Workflow[],
      comparison?: Workflow,
      readRuns?: () => Workflow[],
      onCompare?: () => void,
    ) => {
      const github = createGithub(
        candidate,
        jobs,
        comparison,
        readRuns,
        onCompare,
      );
      let now = 0;
      const warnings: string[] = [];
      const helpers = await createHelpers(
        github,
        "BuilderIO",
        "agent-native",
        { warning: (message) => warnings.push(message) },
        (timeoutMs) => Date.now() + timeoutMs,
        async (ms) => {
          now += ms;
        },
        15_000,
        5,
      );
      const withFakeClock = async <T>(operation: () => Promise<T>) => {
        const realNow = Date.now;
        now = 0;
        Date.now = () => now;
        try {
          return await operation();
        } finally {
          Date.now = realNow;
        }
      };
      return {
        docsSourceHasCurrentInputs: (sourceSha: string, mainSha: string) =>
          withFakeClock(() =>
            helpers.docsSourceHasCurrentInputs(sourceSha, mainSha),
          ),
        findSuccessfulDocsPushDeployment: () =>
          withFakeClock(() => helpers.findSuccessfulDocsPushDeployment()),
        warnings,
      };
    };

    const current = await runHelpers(run, [successfulDeploy]);
    assert.deepEqual(await current.findSuccessfulDocsPushDeployment(), {
      id: run.id,
      url: run.html_url,
    });
    assert.equal(
      await current.docsSourceHasCurrentInputs(mainSha, mainSha),
      true,
    );

    const skippedStableRelease = await runHelpers(run, [
      { ...successfulDeploy, conclusion: "skipped" },
    ]);
    assert.equal(
      await skippedStableRelease.findSuccessfulDocsPushDeployment(),
      null,
    );

    for (const notSuccessful of [
      { ...run, status: "in_progress", conclusion: null },
      { ...run, status: "completed", conclusion: "failure" },
    ]) {
      let comparisons = 0;
      const unqualifiedRun = await runHelpers(
        notSuccessful,
        [successfulDeploy],
        {
          status: "ahead",
          total_commits: 1,
          commits: [{ sha: mainSha }],
          files: [{ filename: "packages/core/docs/content/guide.md" }],
        },
        undefined,
        () => {
          comparisons += 1;
        },
      );
      assert.equal(
        await unqualifiedRun.findSuccessfulDocsPushDeployment(),
        null,
      );
      assert.equal(comparisons, 0);
    }

    const oldSha = "b".repeat(40);
    const oldRun = { ...run, head_sha: oldSha };
    const docsChangedAfterRun = await runHelpers(oldRun, [successfulDeploy], {
      status: "ahead",
      total_commits: 1,
      commits: [{ sha: mainSha }],
      files: [{ filename: "packages/core/docs/content/guide.md" }],
    });
    assert.equal(
      await docsChangedAfterRun.findSuccessfulDocsPushDeployment(),
      null,
    );

    const unrelatedChangeAfterRun = await runHelpers(
      oldRun,
      [successfulDeploy],
      {
        status: "ahead",
        total_commits: 1,
        commits: [{ sha: mainSha }],
        files: [{ filename: "README.md" }],
      },
    );
    assert.deepEqual(
      await unrelatedChangeAfterRun.findSuccessfulDocsPushDeployment(),
      {
        id: run.id,
        url: run.html_url,
      },
    );

    const earlierRun = {
      ...oldRun,
      id: 41,
      html_url: "https://github.com/BuilderIO/agent-native/actions/runs/41",
    };
    const laterRun = {
      ...oldRun,
      id: 43,
      head_sha: "c".repeat(40),
      html_url: "https://github.com/BuilderIO/agent-native/actions/runs/43",
    };
    let failedComparisons = 0;
    const continuesAfterComparisonFailure = await runHelpers(
      earlierRun,
      [successfulDeploy],
      {
        status: "ahead",
        total_commits: 1,
        commits: [{ sha: mainSha }],
        files: [{ filename: "README.md" }],
      },
      () => [earlierRun, laterRun],
      () => {
        failedComparisons += 1;
        if (failedComparisons === 1) {
          throw new Error("transient compare failure");
        }
      },
    );
    assert.deepEqual(
      await continuesAfterComparisonFailure.findSuccessfulDocsPushDeployment(),
      { id: laterRun.id, url: laterRun.html_url },
    );
    assert.equal(failedComparisons, 2);
    assert.match(
      continuesAfterComparisonFailure.warnings[0],
      /continuing through/,
    );

    let delayedRunPolls = 0;
    const delayedRun = await runHelpers(
      run,
      [successfulDeploy],
      undefined,
      () => (++delayedRunPolls < 7 ? [] : [run]),
    );
    assert.deepEqual(await delayedRun.findSuccessfulDocsPushDeployment(), {
      id: run.id,
      url: run.html_url,
    });
    assert.equal(delayedRunPolls, 7);

    let comparisons = 0;
    const cachedFreshness = await runHelpers(
      oldRun,
      [successfulDeploy],
      {
        status: "ahead",
        total_commits: 1,
        commits: [{ sha: mainSha }],
        files: [{ filename: "packages/core/docs/content/guide.md" }],
      },
      undefined,
      () => {
        comparisons += 1;
      },
    );
    assert.equal(
      await cachedFreshness.docsSourceHasCurrentInputs(oldSha, mainSha),
      false,
    );
    assert.equal(
      await cachedFreshness.docsSourceHasCurrentInputs(oldSha, mainSha),
      false,
    );
    assert.equal(comparisons, 1);

    assert.match(source, /async function dispatchDocsAndReconcile\(\)/);
    assert.match(source, /index === 3 && reconciledDocsRun/);
  });

  it("waits through the observed stable release review and CI delay", async () => {
    const source = String((coordinator.with as Workflow).script);
    const helperStart = source.indexOf(
      "async function waitForReleaseMerge(pr)",
    );
    const helperEnd = source.indexOf(
      "\n\nasync function waitForStablePackagePublish",
      helperStart,
    );
    assert(helperStart >= 0 && helperEnd > helperStart);
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    const createWaitForReleaseMerge = new AsyncFunction(
      "github",
      "owner",
      "repo",
      "phaseDeadline",
      "sleep",
      "pollIntervalMs",
      "core",
      `${source.slice(helperStart, helperEnd)}
return waitForReleaseMerge;`,
    ) as (
      github: Workflow,
      owner: string,
      repo: string,
      phaseDeadline: (timeoutMs: number) => number,
      sleep: (ms: number) => Promise<void>,
      pollIntervalMs: number,
      core: Workflow,
    ) => (pr: Workflow) => Promise<string>;

    const realNow = Date.now;
    let now = 0;
    Date.now = () => now;
    try {
      const github = {
        rest: {
          pulls: {
            get: async () => ({
              data:
                now >= 196 * 60_000
                  ? { merged: true, merge_commit_sha: "a".repeat(40) }
                  : { merged: false, state: "open" },
            }),
          },
        },
      } as Workflow;
      const waitForReleaseMerge = await createWaitForReleaseMerge(
        github,
        "BuilderIO",
        "agent-native",
        (timeoutMs) => Math.min(350 * 60_000, Date.now() + timeoutMs),
        async (ms) => {
          now += ms;
        },
        20 * 60_000,
        { info: () => {} },
      );
      assert.equal(await waitForReleaseMerge({ number: 8062 }), "a".repeat(40));
      assert(now < 210 * 60_000);

      now = 120 * 60_000;
      const noMergeGithub = {
        rest: {
          pulls: {
            get: async () => ({ data: { merged: false, state: "open" } }),
          },
        },
      } as Workflow;
      const reserveBoundedWait = await createWaitForReleaseMerge(
        noMergeGithub,
        "BuilderIO",
        "agent-native",
        (timeoutMs) => Math.min(350 * 60_000, Date.now() + timeoutMs),
        async (ms) => {
          now += ms;
        },
        20 * 60_000,
        { info: () => {} },
      );
      await assert.rejects(
        reserveBoundedWait({ number: 8102 }),
        /did not merge in time/,
      );
      assert.equal(now, 330 * 60_000);
    } finally {
      Date.now = realNow;
    }
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
      "if (downstreamNotificationFailureUrl || downstreamNotificationRecoveryError)",
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
      /Stable npm packages were published, but downstream package notifications were not delivered/,
    );
    assert.ok(stablePublishStart >= 0);
    assert.ok(failureGate > stablePublishStart);
    assert.ok(packageTagCheck > failureGate);
    assert.ok(retryDispatch > packageTagCheck);
    assert.ok(downstreamSettled >= 0);
    assert.ok(notificationFailure > downstreamSettled);
    assert.ok(completionLog > notificationFailure);
  });

  it("continues desktop releases when notification recovery fails after npm publication", async () => {
    const source = String((coordinator.with as Workflow).script);
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    const stablePublishStart = source.indexOf(
      "async function waitForStablePackagePublish",
    );
    const stablePublishEnd = source.indexOf(
      "\n\nconst docsDeploymentPaths",
      stablePublishStart,
    );
    const publicationStart = source.indexOf(
      "let publicationError = null;",
      stablePublishEnd,
    );
    const publicationEnd = source.indexOf(
      "\n\nconst sitesManifest",
      publicationStart,
    );
    assert.ok(stablePublishStart >= 0 && stablePublishEnd > stablePublishStart);
    assert.ok(
      publicationStart > stablePublishEnd && publicationEnd > publicationStart,
    );

    const mergeSha = "a".repeat(40);
    const workflowRun = {
      id: 42,
      html_url: "https://github.com/BuilderIO/agent-native/actions/runs/42",
      event: "push",
      head_sha: mergeSha,
    };
    const errors: string[] = [];
    const runScenario = new AsyncFunction(
      "phaseDeadline",
      "pollIntervalMs",
      "github",
      "owner",
      "repo",
      "waitForRun",
      "requireRecoverableStablePublishFailure",
      "getRemoteTagSha",
      "core",
      "recoverDownstreamNotification",
      "sleep",
      "releaseSha",
      "packageRef",
      "coreVersionChanged",
      "workflowRef",
      "downstreamNotificationFailureUrl",
      "downstreamNotificationRecoveryUrl",
      "downstreamNotificationRecoveryError",
      `${source.slice(stablePublishStart, stablePublishEnd)}
${source.slice(publicationStart, publicationEnd)}
return { publicationError, siteWorkflowRef, downstreamNotificationFailureUrl, downstreamNotificationRecoveryUrl, downstreamNotificationRecoveryError };`,
    ) as (...args: unknown[]) => Promise<{
      publicationError: Error | null;
      siteWorkflowRef: string;
      downstreamNotificationFailureUrl?: string;
      downstreamNotificationRecoveryUrl?: string;
      downstreamNotificationRecoveryError?: Error;
    }>;
    const result = await runScenario(
      (timeoutMs: number) => Date.now() + timeoutMs,
      15_000,
      {
        rest: {
          actions: {
            listWorkflowRuns: async () => ({
              data: { workflow_runs: [workflowRun] },
            }),
          },
        },
      },
      "BuilderIO",
      "agent-native",
      async () => ({ conclusion: "failure" }),
      async () => {},
      async () => mergeSha,
      {
        warning: () => {},
        error: (message: string) => errors.push(message),
      },
      async () => {
        throw new Error("notification API unavailable");
      },
      async () => {},
      mergeSha,
      "@agent-native/core@1.2.3",
      true,
      "@agent-native/core@1.2.3",
      undefined,
      undefined,
      undefined,
    );

    assert.equal(result.publicationError, null);
    assert.equal(result.siteWorkflowRef, "@agent-native/core@1.2.3");
    assert.match(
      result.downstreamNotificationRecoveryError?.message ?? "",
      /notification API unavailable/,
    );
    assert.match(errors[0] ?? "", /continuing desktop and production releases/);

    const downstreamStart = source.indexOf(
      "const downstream = await Promise.allSettled",
    );
    const downstreamEnd = source.indexOf("const failures =", downstreamStart);
    assert.ok(downstreamStart >= 0 && downstreamEnd > downstreamStart);
    const dispatches: string[] = [];
    const releaseDownstream = new AsyncFunction(
      "publicationError",
      "releaseSha",
      "workflowRef",
      "siteWorkflowRef",
      "desktopVersion",
      "clipsVersion",
      "productionSites",
      "dispatchAndWait",
      "dispatchDocsAndReconcile",
      `${source.slice(downstreamStart, downstreamEnd)}
return downstream;`,
    ) as (...args: unknown[]) => Promise<unknown>;
    await releaseDownstream(
      result.publicationError,
      mergeSha,
      "@agent-native/core@1.2.3",
      result.siteWorkflowRef,
      "1.2.3",
      "1.2.3",
      ["design"],
      async (workflow: string) => {
        dispatches.push(workflow);
        return { run: { id: dispatches.length }, error: null };
      },
      async () => ({ run: { id: 4 }, error: null }),
    );
    assert.deepEqual(dispatches, [
      "desktop-release.yml",
      "clips-desktop-release.yml",
      "deploy-production-sites-prebuilt.yml",
    ]);
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

  it("re-runs a stage only after GitHub itself cancelled its unstarted jobs", async () => {
    const source = String((coordinator.with as Workflow).script);
    const start = source.indexOf("function neverStartedFailures");
    const end = source.indexOf("function requireSingleJob", start);
    assert(start >= 0 && end > start);
    type Run = {
      run_attempt: number;
      status: string;
      conclusion: string | null;
    };
    type Annotation = { annotation_level: string; message: string };
    const run = (
      run_attempt: number,
      status: string,
      conclusion: string | null = null,
    ): Run => ({ run_attempt, status, conclusion });
    const failure = (message: string): Annotation => ({
      annotation_level: "failure",
      message,
    });
    // Annotation texts recorded on BuilderIO/agent-native jobs.
    const superseded = failure(
      "Canceling since a higher priority waiting request for ci-6360 exists",
    );
    const noRunner = failure(
      "The job was not acquired by Runner of type hosted even after multiple attempts",
    );
    const operator = failure("The run was canceled by @steve8708.");
    const labelNotice = {
      annotation_level: "notice",
      message: "The ubuntu-latest label will migrate to Ubuntu 26",
    };

    const runStage = (
      reads: Run[],
      annotations: Record<number, Annotation[] | Error>,
    ) => {
      let polls = 0;
      let reruns = 0;
      const warnings: string[] = [];
      const waitForRun = new Function(
        "getRun",
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
        {
          rest: {
            actions: {
              listJobsForWorkflowRun: async () => ({
                data: {
                  jobs: [
                    { id: 0, name: "fw", conclusion: "success", steps: [{}] },
                    ...Object.keys(annotations).map((id) => ({
                      id: Number(id),
                      name: `site ${id}`,
                      conclusion: "cancelled",
                      steps: [],
                    })),
                  ],
                },
              }),
              reRunWorkflowFailedJobs: async () => {
                reruns += 1;
              },
            },
            checks: {
              listAnnotations: async ({
                check_run_id,
              }: {
                check_run_id: number;
              }) => {
                const result = annotations[check_run_id];
                if (result instanceof Error) throw result;
                return { data: result };
              },
            },
          },
        },
        { info() {}, warning: (message: string) => warnings.push(message) },
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
      return { result, counts: () => ({ polls, reruns }), warnings };
    };

    // After the re-run request GitHub can keep returning the old completed
    // attempt for a few polls before it reports the new one.
    const cancelled = run(1, "completed", "cancelled");
    const stale = [cancelled, cancelled, cancelled];

    const supersededStage = runStage(
      [
        cancelled,
        ...stale,
        run(2, "in_progress"),
        run(2, "completed", "success"),
      ],
      { 1: [labelNotice, superseded], 2: [superseded] },
    );
    assert.deepEqual(
      await supersededStage.result,
      run(2, "completed", "success"),
    );
    assert.deepEqual(supersededStage.counts(), { polls: 6, reruns: 1 });

    const noRunnerStage = runStage(
      [cancelled, ...stale, run(2, "queued"), run(2, "completed", "failure")],
      { 1: [noRunner] },
    );
    await assert.rejects(
      noRunnerStage.result,
      /Production site fleet ended failure after one re-run: run/,
    );
    assert.deepEqual(noRunnerStage.counts(), { polls: 6, reruns: 1 });

    // Run 36645799548: an operator's cancel annotates one queued job and
    // leaves the others without a reason.
    for (const annotations of [
      { 1: [operator], 2: [] },
      { 1: [superseded], 2: [operator] },
      // Production fleet run 36627218071 (9/29) recorded no reason at all.
      { 1: [], 2: [] },
      { 1: [superseded], 2: new Error("HTTP 502") },
    ]) {
      const stage = runStage([cancelled], annotations);
      await assert.rejects(
        stage.result,
        /^Error: Production site fleet ended cancelled: run$/,
      );
      assert.equal(stage.counts().reruns, 0);
    }
    const unreadable = runStage([cancelled], { 1: new Error("HTTP 502") });
    await assert.rejects(unreadable.result, /ended cancelled: run/);
    assert.match(
      unreadable.warnings.join("\n"),
      /could not read why its jobs were cancelled, so it is not re-run: HTTP 502/,
    );
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
      /dispatchAndWait\(\s*"deploy-production-sites-prebuilt\.yml",\s*siteWorkflowRef,\s*\{\s*sites: productionSites\.join\(","\),\s*source_ref: releaseSha,/,
    );
    assert.match(
      source,
      /publicationError\s*\? Promise\.resolve\(null\)\s*: dispatchAndWait\(\s*"desktop-release\.yml"/,
    );
    assert.match(
      source,
      /publicationError\s*\? Promise\.resolve\(null\)\s*: dispatchAndWait\(\s*"clips-desktop-release\.yml"/,
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
