import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { parse } from "yaml";

import { RELEASE_COORDINATOR_STEP_NAME } from "./release-coordinator.ts";
import {
  getRemoteTagSha,
  nextStableVersion,
  reserveStableVersion as reserveStableVersionInModule,
} from "./stable-release-version.ts";

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
        assert.equal(
          (error as Error & { dispatchOutcome?: string }).dispatchOutcome,
          undefined,
        );
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
      (error: Error & { dispatchOutcome?: string }) => {
        assert.match(error.message, /Validation failed/);
        assert.equal(error.dispatchOutcome, "rejected");
        return true;
      },
    );
    assert.equal(invalidStatusLookups, 0);
  });

  it("waits for accepted sibling releases when one dispatch is unconfirmed", async () => {
    const source = String((coordinator.with as Workflow).script);
    const fanoutStart = source.indexOf(
      "const siteReleases = Promise.allSettled([",
    );
    const fanoutEnd = source.indexOf("]);", fanoutStart);
    assert(fanoutStart >= 0 && fanoutEnd > fanoutStart);
    const fanout = source.slice(fanoutStart, fanoutEnd);
    assert.equal((fanout.match(/dispatchAndWait\(/g) ?? []).length, 1);
    assert.match(fanout, /dispatchDocsAndReconcile\(\)/);
    const lanesStart = source.indexOf(
      "const desktopReleases = Promise.all(desktopApps.map(releaseDesktopApp));",
    );
    assert(lanesStart >= 0 && lanesStart < fanoutStart);
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

  it("cleans a reserved desktop tag only after a confirmed dispatch rejection", async () => {
    const source = String((coordinator.with as Workflow).script);
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
      "cleanupReservedTags",
      `${source.slice(helperStart, helperEnd)}\nreturn dispatchAndWait;`,
    ) as (
      dispatch: (
        workflow: string,
        ref: string,
        inputs: Workflow,
      ) => Promise<{ id: number; url: string }>,
      waitForRun: () => Promise<void>,
      cleanupReservedTags: (tags: string[]) => Promise<void>,
    ) => Promise<
      (
        workflow: string,
        ref: string,
        inputs: Workflow,
        label: string,
        timeoutMs: number,
        reservedTag?: string,
      ) => Promise<{ run: { id: number; url: string }; error: unknown }>
    >;

    const cleanedTags: string[] = [];
    const dispatchAndWait = await createDispatchAndWait(
      async (workflow) => {
        if (workflow === "rejected.yml") {
          throw Object.assign(new Error("HTTP 404: workflow unavailable"), {
            dispatchOutcome: "rejected",
          });
        }
        throw new Error("Could not confirm workflow dispatch");
      },
      async () => {},
      async (tags) => {
        cleanedTags.push(...tags);
      },
    );

    await assert.rejects(
      dispatchAndWait(
        "rejected.yml",
        "main",
        {},
        "Desktop release",
        60_000,
        "v1.2.4",
      ),
      /HTTP 404: workflow unavailable/,
    );
    assert.deepEqual(cleanedTags, ["v1.2.4"]);

    await assert.rejects(
      dispatchAndWait(
        "ambiguous.yml",
        "main",
        {},
        "Clips release",
        60_000,
        "clips-v2.3.4",
      ),
      /Could not confirm workflow dispatch/,
    );
    assert.deepEqual(cleanedTags, ["v1.2.4"]);
  });

  it("starts docs push reconciliation before sibling releases settle", async () => {
    const source = String((coordinator.with as Workflow).script);
    const helperStart = source.indexOf("let reconciledDocsRun = null;");
    const fanoutStart = source.indexOf(
      "const siteReleases = Promise.allSettled([",
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
      "productionSites",
      `${source.slice(helperStart, fanoutEnd + "]);".length)}
return { siteReleases: await siteReleases, getReconciledDocsRun: () => reconciledDocsRun };`,
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
      productionSites: string[],
    ) => Promise<{
      siteReleases: PromiseSettledResult<Workflow>[];
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
      ["chat", "design"],
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
    const { siteReleases, getReconciledDocsRun } = await fanoutPromise;

    assert.equal(timedOut, false);
    assert.deepEqual(siblingWorkflows, [
      "deploy-production-sites-prebuilt.yml",
    ]);
    assert.equal(siblingCountAtReconciliation, 1);
    assert.equal(siblingsFinishedAtReconciliation, false);
    assert.equal(getReconciledDocsRun(), reconciledRun);
    assert.equal(siteReleases.length, 2);
    const docsResult = siteReleases[1];
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

  it("scopes release PR discovery to the stable release branch", async () => {
    const source = String((coordinator.with as Workflow).script);
    const helperStart = source.indexOf(
      "async function listReleasePullRequests()",
    );
    const helperEnd = source.indexOf(
      "\n\nfunction isStableReleasePullRequest",
      helperStart,
    );
    assert(helperStart >= 0 && helperEnd > helperStart);

    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    const createListReleasePullRequests = new AsyncFunction(
      "github",
      "owner",
      "repo",
      `${source.slice(helperStart, helperEnd)}\nreturn listReleasePullRequests;`,
    ) as (
      github: {
        rest: {
          pulls: {
            list: (options: Workflow) => Promise<{ data: Workflow[] }>;
          };
        };
      },
      owner: string,
      repo: string,
    ) => Promise<() => Promise<Workflow[]>>;

    const requests: Workflow[] = [];
    const github = {
      rest: {
        pulls: {
          list: async (options: Workflow) => {
            requests.push(options);
            return { data: [] };
          },
        },
      },
    };
    const listReleasePullRequests = await createListReleasePullRequests(
      github,
      "BuilderIO",
      "agent-native",
    );
    assert.deepEqual(await listReleasePullRequests(), []);
    assert.deepEqual(requests, [
      {
        owner: "BuilderIO",
        repo: "agent-native",
        state: "all",
        base: "main",
        head: "BuilderIO:changeset-release/main",
        sort: "updated",
        direction: "desc",
        per_page: 100,
      },
    ]);
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
    // Version picking lives in scripts/stable-release-version.ts, which a
    // stable desktop release run by hand imports too.
    const checkout = steps[0];
    assert.equal(
      checkout.uses,
      "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5",
    );
    assert.deepEqual(checkout.with, {
      "sparse-checkout": "scripts",
      "persist-credentials": false,
    });
    assert.match(
      source,
      /await import\(\s*`\$\{process\.env\.GITHUB_WORKSPACE\}\/scripts\/stable-release-version\.ts`/,
    );
    assert.match(
      source,
      /stableReleases\.getRemoteTagSha\(github, repoRef, tag\)/,
    );
    assert.match(
      source,
      /stableReleases\.reserveStableVersion\(github, repoRef, \{/,
    );
    assert.doesNotMatch(
      source,
      /async function (?:nextStableVersion|reserveStableVersion)/,
    );
    assert.match(source, /github\.paginate\(github\.rest\.repos\.listReleases/);
    assert.match(source, /const tagSha = await getRemoteTagSha\(tag\)/);
    assert.match(source, /const reservedTags = new Map\(\)/);
    assert.match(
      source,
      /async function cleanupReservedTags\(tags = \[\.\.\.reservedTags\.keys\(\)\]\)/,
    );
    assert.match(source, /github\.rest\.repos\.deleteRelease/);
    assert.match(source, /github\.rest\.git\.deleteRef/);
    assert.match(source, /if \(tag\) await cleanupReservedTags\(\[tag\]\)/);
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
      /workflow: "desktop-release\.yml",\s*tagPrefix: "v",\s*packagePath: "packages\/desktop-app\/package\.json",/,
    );
    assert.match(
      source,
      /workflow: "clips-desktop-release\.yml",\s*tagPrefix: "clips-v",\s*packagePath: "templates\/clips\/desktop\/package\.json",/,
    );
    const publicationStart = source.indexOf(
      "const stablePublication = verifyStablePublication();",
    );
    const lanesStart = source.indexOf(
      "const desktopReleases = Promise.all(desktopApps.map(releaseDesktopApp));",
    );
    assert(publicationStart >= 0 && lanesStart > publicationStart);
    assert(lanesStart < source.indexOf("await stablePublication;", lanesStart));
    assert.doesNotMatch(
      source,
      /desktopAlreadyPublished|clipsAlreadyPublished/,
    );
    assert.match(source, /source_ref: releaseSha/);
    assert.match(source, /endsWith\("\.agent-native\.com"\)/);
    assert.match(source, /Promise\.allSettled/);
  });

  it("reconciles ambiguous stable tag reservations before cleanup", async () => {
    const source = String((coordinator.with as Workflow).script);
    const cleanupStart = source.indexOf(
      "// GET releases/tags/{tag} answers 404",
    );
    const cleanupEnd = source.indexOf(
      "\n\nasync function getFirstParentSha(ref)",
      cleanupStart,
    );
    assert(cleanupStart >= 0 && cleanupEnd > cleanupStart);
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    type TagObject = { type: string; sha: string };
    type ReleaseRow = { id: number; tag_name: string; draft: boolean };
    type HarnessOptions = {
      createRef: (
        request: { ref: string; sha: string },
        remoteTags: Map<string, TagObject>,
      ) => Promise<void>;
      // Tag reads fail only after createRef, so version selection still works.
      getRefError?: Error & { status?: number };
    };

    const createCleanup = new AsyncFunction(
      "github",
      "owner",
      "repo",
      "core",
      "reservedTags",
      "getRemoteTagSha",
      `${source.slice(cleanupStart, cleanupEnd)}\nreturn cleanupReservedTags;`,
    ) as (
      github: unknown,
      owner: string,
      repo: string,
      core: {
        warning: (message: string) => void;
        info: (message: string) => void;
      },
      reservedTags: Map<string, string>,
      getRemoteTagSha: (tag: string) => Promise<string | null>,
    ) => Promise<() => Promise<void>>;

    const makeHarness = async ({ createRef, getRefError }: HarnessOptions) => {
      const remoteTags = new Map<string, TagObject>();
      const reservedTags = new Map<string, string>();
      const releases: ReleaseRow[] = [];
      const deletedRefs: string[] = [];
      const deletedReleases: number[] = [];
      const warnings: string[] = [];
      let createRefCalled = false;
      const notFound = () =>
        Object.assign(new Error("Not found"), { status: 404 });
      const github = {
        paginate: async (_method: unknown, options: { per_page: number }) => {
          assert.equal(options.per_page, 100);
          return releases.map((release) => ({ prerelease: false, ...release }));
        },
        rest: {
          git: {
            createRef: async (request: { ref: string; sha: string }) => {
              createRefCalled = true;
              return createRef(request, remoteTags);
            },
            getRef: async ({ ref }: { ref: string }) => {
              if (getRefError && createRefCalled) throw getRefError;
              const object = remoteTags.get(ref);
              if (!object) throw notFound();
              return { data: { object } };
            },
            getTag: async ({ tag_sha }: { tag_sha: string }) => ({
              data: { object: { sha: tag_sha } },
            }),
            deleteRef: async ({ ref }: { ref: string }) => {
              deletedRefs.push(ref);
              if (!remoteTags.delete(ref)) throw notFound();
            },
          },
          repos: {
            listReleases: async () => ({ data: releases }),
            deleteRelease: async ({ release_id }: { release_id: number }) => {
              deletedReleases.push(release_id);
            },
          },
        },
      };
      const repoRef = { owner: "BuilderIO", repo: "agent-native" };
      const cleanupReservedTags = await createCleanup(
        github,
        repoRef.owner,
        repoRef.repo,
        {
          warning: (message) => warnings.push(message),
          info: () => {},
        },
        reservedTags,
        (tag) => getRemoteTagSha(github, repoRef, tag),
      );
      const reserveStableVersion = (
        tagPrefix: string,
        baseVersion: string,
        sourceSha: string,
      ) =>
        reserveStableVersionInModule(github, repoRef, {
          tagPrefix,
          baseVersion,
          sourceSha,
          warn: (message) => warnings.push(message),
          onReserved: (tag) => reservedTags.set(tag, sourceSha),
        });
      return {
        reserveStableVersion,
        cleanupReservedTags,
        deletedRefs,
        deletedReleases,
        releases,
        remoteTags,
        reservedTags,
        warnings,
      };
    };
    const sourceSha = "release-source-sha";
    const acceptedThenFailed = Object.assign(
      new Error("GitHub returned HTTP 502 after accepting createRef"),
      { status: 502 },
    );
    const acceptedHarness = await makeHarness({
      createRef: async ({ ref, sha }, remoteTags) => {
        remoteTags.set(ref.replace(/^refs\//, ""), { type: "commit", sha });
        throw acceptedThenFailed;
      },
    });
    await assert.rejects(
      acceptedHarness.reserveStableVersion("v", "1.2.3", sourceSha),
      (error) => error === acceptedThenFailed,
    );
    assert.deepEqual(
      [...acceptedHarness.reservedTags],
      [["v1.2.4", sourceSha]],
    );
    await acceptedHarness.cleanupReservedTags();
    assert.deepEqual(acceptedHarness.deletedRefs, ["tags/v1.2.4"]);
    assert.equal(acceptedHarness.remoteTags.has("tags/v1.2.4"), false);

    for (const remoteSha of [null, "another-source-sha"]) {
      const failed = Object.assign(new Error("GitHub returned HTTP 502"), {
        status: 502,
      });
      const harness = await makeHarness({
        createRef: async ({ ref }, remoteTags) => {
          if (remoteSha) {
            remoteTags.set(ref.replace(/^refs\//, ""), {
              type: "commit",
              sha: remoteSha,
            });
          }
          throw failed;
        },
      });
      await assert.rejects(
        harness.reserveStableVersion("v", "1.2.3", sourceSha),
        (error) => error === failed,
      );
      assert.equal(harness.reservedTags.size, 0);
      await harness.cleanupReservedTags();
      assert.deepEqual(harness.deletedRefs, []);
    }

    const readbackFailure = Object.assign(
      new Error("GitHub tag lookup failed"),
      { status: 503 },
    );
    const originalFailure = Object.assign(
      new Error("GitHub createRef timed out"),
      { status: 502 },
    );
    const unreadableHarness = await makeHarness({
      createRef: async () => {
        throw originalFailure;
      },
      getRefError: readbackFailure,
    });
    await assert.rejects(
      unreadableHarness.reserveStableVersion("v", "1.2.3", sourceSha),
      (error) => error === originalFailure,
    );
    assert.equal(unreadableHarness.reservedTags.size, 0);
    assert.match(unreadableHarness.warnings[0], /GitHub tag lookup failed/);

    const collision = Object.assign(new Error("Reference already exists"), {
      status: 422,
    });
    const collisionHarness = await makeHarness({
      createRef: async ({ ref, sha }, remoteTags) => {
        if (ref.endsWith("v1.2.4")) {
          remoteTags.set(ref.replace(/^refs\//, ""), {
            type: "commit",
            sha: "another-source-sha",
          });
          throw collision;
        }
        remoteTags.set(ref.replace(/^refs\//, ""), { type: "commit", sha });
      },
    });
    assert.equal(
      await collisionHarness.reserveStableVersion("v", "1.2.3", sourceSha),
      "1.2.5",
    );
    assert.deepEqual(
      [...collisionHarness.reservedTags],
      [["v1.2.5", sourceSha]],
    );
    await collisionHarness.cleanupReservedTags();
    assert.deepEqual(collisionHarness.deletedRefs, ["tags/v1.2.5"]);
    assert.equal(collisionHarness.remoteTags.has("tags/v1.2.4"), true);

    // A staged build leaves a draft, sometimes two from an older run, that
    // only a listing finds.
    const reserveAndClean = async (releases: ReleaseRow[]) => {
      const harness = await makeHarness({
        createRef: async ({ ref, sha }, remoteTags) => {
          remoteTags.set(ref.replace(/^refs\//, ""), { type: "commit", sha });
        },
      });
      assert.equal(
        await harness.reserveStableVersion("v", "1.2.3", sourceSha),
        "1.2.4",
      );
      harness.releases.push(...releases);
      await harness.cleanupReservedTags();
      return harness;
    };
    const drafts = await reserveAndClean([
      { id: 7, tag_name: "v1.2.4", draft: true },
      { id: 8, tag_name: "v1.2.40", draft: true },
      { id: 9, tag_name: "v1.2.4", draft: true },
    ]);
    assert.deepEqual(drafts.deletedReleases, [7, 9]);
    assert.deepEqual(drafts.deletedRefs, ["tags/v1.2.4"]);

    const published = await reserveAndClean([
      { id: 7, tag_name: "v1.2.4", draft: true },
      { id: 9, tag_name: "v1.2.4", draft: false },
    ]);
    assert.deepEqual(published.deletedReleases, []);
    assert.deepEqual(published.deletedRefs, []);
    assert.equal(published.remoteTags.has("tags/v1.2.4"), true);
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
    assert.match(
      source,
      /const docs = siteOutcome\("Agent-Native docs production site", docsResult\)/,
    );
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
      /\["Docs site", `\$\{docs\.outcome\}: \$\{docsSite\.host\}`\]/,
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
    assert.equal(
      (
        source.match(
          /return \{ (?:\.\.\.docsResult, )?run: reconciledDocsRun, error: null \};/g,
        ) ?? []
      ).length,
      2,
    );
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
      "const [productionResult, docsResult] = await siteReleases;",
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
      "async function verifyStablePublication()",
      stablePublishEnd,
    );
    const publicationEnd = source.indexOf(
      "\n\nconst desktopApps",
      publicationStart,
    );
    const verdictStart = source.indexOf(
      "\nconst { publicationError, publicationStatusUnknownError } =",
      publicationEnd,
    );
    const verdictEnd = source.indexOf(
      "\n\n// Each child waits independently",
      verdictStart,
    );
    assert.ok(stablePublishStart >= 0 && stablePublishEnd > stablePublishStart);
    assert.ok(
      publicationStart > stablePublishEnd && publicationEnd > publicationStart,
    );
    assert.ok(verdictStart > publicationEnd && verdictEnd > verdictStart);

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
${source.slice(verdictStart, verdictEnd)}
return { publicationError, publicationStatusUnknownError, publicationUnavailable, siteWorkflowRef, downstreamNotificationFailureUrl, downstreamNotificationRecoveryUrl, downstreamNotificationRecoveryError };`,
    ) as (...args: unknown[]) => Promise<{
      publicationError: Error | null;
      publicationStatusUnknownError?: Error | null;
      publicationUnavailable?: Error | null;
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

    // Desktop lanes publish whenever neither publication error is set.
    assert.equal(result.publicationError, null);
    assert.equal(result.publicationStatusUnknownError, null);
    assert.equal(result.publicationUnavailable, null);
    assert.equal(result.siteWorkflowRef, "@agent-native/core@1.2.3");
    assert.match(
      result.downstreamNotificationRecoveryError?.message ?? "",
      /notification API unavailable/,
    );
    assert.match(errors[0] ?? "", /continuing desktop and production releases/);

    const unknownErrors: string[] = [];
    const unknownResult = await runScenario(
      (timeoutMs: number) => Date.now() + timeoutMs,
      15_000,
      {
        rest: {
          actions: {
            listWorkflowRuns: async () => {
              throw new Error("GitHub API read failed");
            },
          },
        },
      },
      "BuilderIO",
      "agent-native",
      async () => ({ conclusion: "success" }),
      async () => {},
      async () => mergeSha,
      {
        warning: () => {},
        error: (message: string) => unknownErrors.push(message),
      },
      async () => {},
      async () => {},
      mergeSha,
      "@agent-native/core@1.2.3",
      true,
      "@agent-native/core@1.2.3",
      undefined,
      undefined,
      undefined,
    );
    assert.equal(unknownResult.publicationError, null);
    assert.match(
      unknownResult.publicationStatusUnknownError?.message ?? "",
      /GitHub API read failed/,
    );
    assert.equal(
      unknownResult.publicationUnavailable,
      unknownResult.publicationStatusUnknownError,
    );
    assert.equal(unknownResult.siteWorkflowRef, "main");
    assert.match(unknownErrors[0] ?? "", /publication status is unknown/);
  });

  it("runs each desktop app in its own lane from merge to publish or discard", async () => {
    const source = String((coordinator.with as Workflow).script);
    const lanesStart = source.indexOf("const desktopApps = [");
    const lanesEnd = source.indexOf(
      "\n\n// Lanes catch their own failures",
      lanesStart,
    );
    const recoveryStart = source.indexOf("function desktopRecovery(lane)");
    const recoveryEnd = source.indexOf("\nconst failedPhases", recoveryStart);
    assert.ok(lanesStart >= 0 && lanesEnd > lanesStart);
    assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart);

    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    type Run = { id: number; url: string };
    type Dispatch = {
      workflow: string;
      ref: string;
      inputs: Workflow;
      label: string;
      timeoutMs: number;
      reservedTag?: string;
    };
    type Lane = {
      app: { workflow: string; label: string };
      phase: string;
      version: string | null;
      stageRun: Run | null;
      run: Run | null;
      error: unknown;
      skipped: boolean;
    };
    type Publication = {
      publicationError: Error | null;
      publicationStatusUnknownError: Error | null;
    };
    const loadLanes = new AsyncFunction(
      "releaseSha",
      "readJsonAt",
      "stableVersion",
      "stableReleases",
      "github",
      "repoRef",
      "core",
      "reservedTags",
      "cleanupReservedTags",
      "dispatchAndWait",
      "stablePublication",
      `${source.slice(lanesStart, lanesEnd)}
${source.slice(recoveryStart, recoveryEnd)}
return { desktopApps, releaseDesktopApp, desktopRecovery };`,
    ) as (...args: unknown[]) => Promise<{
      desktopApps: { workflow: string }[];
      releaseDesktopApp: (app: unknown) => Promise<Lane>;
      desktopRecovery: (lane: Lane) => string;
    }>;

    const releaseSha = "b".repeat(40);
    const runLanes = async ({
      publication = Promise.resolve({
        publicationError: null,
        publicationStatusUnknownError: null,
      }),
      reserveFails = [] as string[],
      dispatch = async (request: Dispatch) => ({
        run: { id: 1, url: `${request.inputs.mode}-${request.ref}` },
        error: null as unknown,
      }),
    }: {
      publication?: Promise<Publication>;
      reserveFails?: string[];
      dispatch?: (request: Dispatch) => Promise<{ run: Run; error: unknown }>;
    } = {}) => {
      const dispatches: Dispatch[] = [];
      const cleaned: string[] = [];
      const reservedTags = new Map<string, string>();
      const lanes = await loadLanes(
        releaseSha,
        async (sha: string, filePath: string) => {
          assert.equal(sha, releaseSha);
          return { version: filePath.includes("clips") ? "2.3.3" : "1.2.2" };
        },
        (version: string) => version,
        {
          reserveStableVersion: async (
            _github: unknown,
            _repoRef: unknown,
            options: {
              tagPrefix: string;
              baseVersion: string;
              sourceSha: string;
              onReserved: (tag: string) => void;
            },
          ) => {
            assert.equal(options.sourceSha, releaseSha);
            const [major, minor, patch] = options.baseVersion.split(".");
            const version = `${major}.${minor}.${Number(patch) + 1}`;
            options.onReserved(`${options.tagPrefix}${version}`);
            if (reserveFails.includes(options.tagPrefix)) {
              throw new Error("GitHub returned HTTP 502 after createRef");
            }
            return version;
          },
        },
        {},
        { owner: "BuilderIO", repo: "agent-native" },
        { info: () => {}, warning: () => {} },
        reservedTags,
        async (tags: string[]) => {
          cleaned.push(...tags);
        },
        (
          workflow: string,
          ref: string,
          inputs: Workflow,
          label: string,
          timeoutMs: number,
          reservedTag?: string,
        ) => {
          const request = {
            workflow,
            ref,
            inputs,
            label,
            timeoutMs,
            reservedTag,
          };
          dispatches.push(request);
          return dispatch(request);
        },
        publication,
      );
      const results = await Promise.all(
        lanes.desktopApps.map(lanes.releaseDesktopApp),
      );
      return { ...lanes, results, dispatches, cleaned, reservedTags };
    };
    const stageInputs = (version: string) => ({
      channel: "production",
      version,
      source_ref: releaseSha,
      mode: "stage",
    });

    // Both builds start before npm's result is known.
    let settlePublication!: (publication: Publication) => void;
    const pendingPublication = new Promise<Publication>((resolve) => {
      settlePublication = resolve;
    });
    const dispatchedBeforeNpm: string[] = [];
    let npmKnown = false;
    const verifiedRun = runLanes({
      publication: pendingPublication,
      dispatch: async (request) => {
        if (!npmKnown)
          dispatchedBeforeNpm.push(`${request.inputs.mode} ${request.ref}`);
        return {
          run: { id: 1, url: `${request.inputs.mode}-${request.ref}` },
          error: null,
        };
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(dispatchedBeforeNpm, [
      "stage v1.2.3",
      "stage clips-v2.3.4",
    ]);
    npmKnown = true;
    settlePublication({
      publicationError: null,
      publicationStatusUnknownError: null,
    });
    const verified = await verifiedRun;
    assert.deepEqual(verified.dispatches, [
      {
        workflow: "desktop-release.yml",
        ref: "v1.2.3",
        inputs: stageInputs("1.2.3"),
        label: "Agent-Native desktop stable release build",
        timeoutMs: 120 * 60_000,
        reservedTag: "v1.2.3",
      },
      {
        workflow: "clips-desktop-release.yml",
        ref: "clips-v2.3.4",
        inputs: stageInputs("2.3.4"),
        label: "Clips desktop stable release build",
        timeoutMs: 120 * 60_000,
        reservedTag: "clips-v2.3.4",
      },
      // A rejected publish dispatch must leave the built draft and its tag.
      {
        workflow: "desktop-release.yml",
        ref: "v1.2.3",
        inputs: { ...stageInputs("1.2.3"), mode: "publish" },
        label: "Agent-Native desktop stable release",
        timeoutMs: 30 * 60_000,
        reservedTag: undefined,
      },
      {
        workflow: "clips-desktop-release.yml",
        ref: "clips-v2.3.4",
        inputs: { ...stageInputs("2.3.4"), mode: "publish" },
        label: "Clips desktop stable release",
        timeoutMs: 30 * 60_000,
        reservedTag: undefined,
      },
    ]);
    assert.deepEqual(
      verified.results.map(
        ({ phase, version, stageRun, run, error, skipped }) => ({
          phase,
          version,
          stageRun: stageRun?.url,
          run: run?.url,
          error,
          skipped,
        }),
      ),
      [
        {
          phase: "publish",
          version: "1.2.3",
          stageRun: "stage-v1.2.3",
          run: "publish-v1.2.3",
          error: null,
          skipped: false,
        },
        {
          phase: "publish",
          version: "2.3.4",
          stageRun: "stage-clips-v2.3.4",
          run: "publish-clips-v2.3.4",
          error: null,
          skipped: false,
        },
      ],
    );
    assert.deepEqual(
      [...verified.reservedTags],
      [
        ["v1.2.3", releaseSha],
        ["clips-v2.3.4", releaseSha],
      ],
    );
    assert.deepEqual(verified.cleaned, []);

    // npm unverified: the built drafts and their tags are discarded.
    const unverified = await runLanes({
      publication: Promise.resolve({
        publicationError: null,
        publicationStatusUnknownError: new Error("npm status unknown"),
      }),
    });
    assert.deepEqual(
      unverified.dispatches.map((request) => request.inputs.mode),
      ["stage", "stage"],
    );
    assert.deepEqual(unverified.cleaned, ["v1.2.3", "clips-v2.3.4"]);
    assert.deepEqual(
      unverified.results.map((lane) => [lane.skipped, lane.error]),
      [
        [true, null],
        [true, null],
      ],
    );
    assert.equal(
      unverified.desktopRecovery(unverified.results[0]),
      `Once npm is published, run desktop-release.yml with channel production and source_ref ${releaseSha}, leaving version blank.`,
    );

    // A desktop reservation failure stops only desktop: Clips still ships.
    const reservationFailure = await runLanes({ reserveFails: ["v"] });
    const [failedDesktop, shippedClips] = reservationFailure.results;
    assert.equal(failedDesktop.phase, "reserve");
    assert.match(String(failedDesktop.error), /HTTP 502 after createRef/);
    assert.deepEqual(reservationFailure.cleaned, ["v1.2.3"]);
    assert.equal(shippedClips.run?.url, "publish-clips-v2.3.4");
    assert.deepEqual(
      reservationFailure.dispatches.map((request) => request.ref),
      ["clips-v2.3.4", "clips-v2.3.4"],
    );
    assert.equal(
      reservationFailure.desktopRecovery(failedDesktop),
      `To release it on its own, run desktop-release.yml with channel production and source_ref ${releaseSha}, leaving version blank.`,
    );

    // A failed build is neither published nor cleaned up.
    const buildFailure = await runLanes({
      dispatch: async (request) => ({
        run: { id: 1, url: `${request.inputs.mode}-${request.ref}` },
        error:
          request.workflow === "clips-desktop-release.yml"
            ? new Error("Clips build ended failure")
            : null,
      }),
    });
    const failedClips = buildFailure.results[1];
    assert.equal(failedClips.phase, "build");
    assert.equal(failedClips.run, null);
    assert.deepEqual(buildFailure.cleaned, []);
    assert.equal(
      buildFailure.dispatches.filter(
        (request) => request.workflow === "clips-desktop-release.yml",
      ).length,
      1,
    );
    assert.equal(
      buildFailure.desktopRecovery(failedClips),
      `Re-run the failed jobs of stage-clips-v2.3.4, then run clips-desktop-release.yml with mode publish, version 2.3.4 and source_ref ${releaseSha}.`,
    );

    // A failed publish run is re-run; a rejected publish dispatch is redone.
    const publishFailure = await runLanes({
      dispatch: async (request) => {
        if (
          request.inputs.mode === "publish" &&
          request.workflow === "desktop-release.yml"
        ) {
          throw new Error("HTTP 422: Unexpected inputs provided");
        }
        return {
          run: { id: 1, url: `${request.inputs.mode}-${request.ref}` },
          error:
            request.inputs.mode === "publish"
              ? new Error("publish ended failure")
              : null,
        };
      },
    });
    const [rejectedPublish, failedPublish] = publishFailure.results;
    assert.equal(rejectedPublish.phase, "publish");
    assert.equal(
      publishFailure.desktopRecovery(rejectedPublish),
      `To publish its build, run desktop-release.yml with mode publish, version 1.2.3 and source_ref ${releaseSha}.`,
    );
    assert.equal(
      publishFailure.desktopRecovery(failedPublish),
      "Re-run the failed jobs of publish-clips-v2.3.4.",
    );

    // A rejected build dispatch fails the lane instead of rejecting it.
    const rejectedBuild = await runLanes({
      dispatch: async () => {
        throw new Error("HTTP 404: workflow unavailable");
      },
    });
    assert.deepEqual(
      rejectedBuild.results.map((lane) => [lane.phase, lane.stageRun]),
      [
        ["build", null],
        ["build", null],
      ],
    );
    assert.match(
      rejectedBuild.desktopRecovery(rejectedBuild.results[0]),
      /^If its build has no run in the Actions history, run desktop-release\.yml/,
    );
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
      /function stablePackagePublicationError\(message, outcome\)/,
    );
    assert.match(
      source,
      /publicationFailure\.publicationOutcome === "failed"[\s\S]*?publicationError = publicationFailure[\s\S]*?publicationStatusUnknownError = publicationFailure/,
    );
    assert.match(
      source,
      /const publicationUnavailable = publicationError \|\| publicationStatusUnknownError/,
    );
    assert.match(
      source,
      /const siteWorkflowRef = publicationUnavailable \? "main" : workflowRef/,
    );
    assert.match(
      source,
      /dispatchAndWait\(\s*"deploy-production-sites-prebuilt\.yml",\s*siteWorkflowRef,\s*\{\s*sites: productionSites\.join\(","\),\s*source_ref: releaseSha,/,
    );
    assert.match(
      source,
      /const siteReleases = Promise\.allSettled\(\[\s*dispatchAndWait\(\s*"deploy-production-sites-prebuilt\.yml"/,
    );
    assert.match(
      source,
      /if \(publicationError \|\| publicationStatusUnknownError\) \{\s*await cleanupReservedTags\(\[tag\]\);/,
    );
    assert.match(
      source,
      /!\/\^\[0-9a-f\]\{40\}\$\/\.test\(current\.merge_commit_sha \|\| ""\)/,
    );
    assert.match(
      source,
      /if \(publicationStatusUnknownError\) \{\s*failures\.push\(\s*`Stable npm publication status is unknown/,
    );
    assert.match(
      source,
      /await summary\.write\(\);\s*if \(failures\.length > 0\) \{\s*throw/,
    );
  });

  it("builds without publishing in stage mode and publishes without building in publish mode", () => {
    // Covers the subset of GitHub expressions these jobs use.
    const evaluate = (
      expression: string,
      mode: string | undefined,
      results: Record<string, string>,
    ) => {
      const js = expression
        .replace(/^\$\{\{([\s\S]*)\}\}$/, "$1")
        .replace(/!cancelled\(\)/g, "true")
        .replace(/inputs\.mode/g, "mode")
        .replace(
          /needs\.([\w-]+)\.result/g,
          (_match, job: string) => `results[${JSON.stringify(job)}]`,
        )
        .replace(/!=/g, "!==")
        .replace(/([^!=])==([^=])/g, "$1===$2");
      return Boolean(
        new Function("mode", "results", `return (${js});`)(mode, results),
      );
    };
    const simulate = (
      childWorkflow: Workflow,
      mode: string | undefined,
      failing: string[] = [],
    ) => {
      const results: Record<string, string> = {};
      for (const [name, childJob] of Object.entries(
        childWorkflow.jobs as Record<string, Workflow>,
      )) {
        const needs = [childJob.needs ?? []].flat() as string[];
        for (const need of needs)
          assert.ok(need in results, `${name} needs ${need}`);
        const expression = String(childJob.if ?? "true").trim();
        const checksStatus = /\b(?:always|cancelled|failure|success)\(\)/.test(
          expression,
        );
        const runs =
          (checksStatus ||
            needs.every((need) => results[need] === "success")) &&
          evaluate(expression, mode, results);
        results[name] = !runs
          ? "skipped"
          : failing.includes(name)
            ? "failure"
            : "success";
      }
      return results;
    };

    for (const [childWorkflow, builds] of [
      [desktopWorkflow, ["build-mac", "build-windows", "build-linux"]],
      [clipsWorkflow, ["build-tauri"]],
    ] as const) {
      const modeInput = (
        ((childWorkflow.on as Workflow).workflow_dispatch as Workflow)
          .inputs as Workflow
      ).mode as Workflow;
      assert.deepEqual(modeInput.options, ["release", "stage", "publish"]);
      assert.equal(modeInput.default, "release");
      assert.equal(
        (childWorkflow.env as Workflow).RELEASE_MODE,
        "${{ inputs.mode || 'release' }}",
      );
      assert.match(String(childWorkflow["run-name"]), /inputs\.mode/);

      const ran = (results: Record<string, string>, jobs: readonly string[]) =>
        jobs.map((name) => results[name]);
      // A push to main (Nightly) has no inputs and must still publish.
      for (const mode of [undefined, "release"]) {
        const results = simulate(childWorkflow, mode);
        assert.deepEqual(
          Object.values(results).filter((result) => result !== "success"),
          [],
        );
      }
      const staged = simulate(childWorkflow, "stage");
      assert.deepEqual(
        ran(staged, builds),
        builds.map(() => "success"),
      );
      assert.equal(staged["publish-release"], "skipped");

      const published = simulate(childWorkflow, "publish");
      assert.equal(published["prepare-release"], "success");
      assert.deepEqual(
        ran(published, builds),
        builds.map(() => "skipped"),
      );
      assert.equal(published["publish-release"], "success");

      for (const mode of [undefined, "release"]) {
        assert.equal(
          simulate(childWorkflow, mode, [builds[0]])["publish-release"],
          "skipped",
        );
      }
      assert.equal(
        simulate(childWorkflow, "publish", ["prepare-release"])[
          "publish-release"
        ],
        "skipped",
      );
    }

    for (const file of [
      ".github/workflows/desktop-release.yml",
      ".github/workflows/clips-desktop-release.yml",
    ]) {
      assert.match(
        readFileSync(file, "utf8"),
        /if \[ "\$RELEASE_MODE" = "publish" \]; then\s*echo "::error::There is no draft release \$TAG to publish/,
      );
    }
  });

  it("refuses to publish a desktop draft missing any platform's installers", () => {
    const publishSteps = (
      (desktopWorkflow.jobs as Workflow)["publish-release"] as Workflow
    ).steps as Workflow[];
    const check = publishSteps[0];
    assert.equal(check.name, "Require every platform's installers");
    assert.equal(publishSteps[1].name, "Publish draft release");

    // Manifests as electron-builder writes them for v0.1.292.
    const manifests: Record<string, string[]> = {
      "latest.yml": [
        "Agent-Native-x64.exe",
        "Agent-Native-arm64.exe",
        "Agent-Native.exe",
      ],
      "latest-mac.yml": [
        "Agent-Native-0.1.292-arm64-mac.zip",
        "Agent-Native-arm64.dmg",
        "Agent-Native-0.1.292-mac.zip",
      ],
      "latest-linux.yml": [
        "Agent-Native-x86_64.AppImage",
        "Agent-Native-amd64.deb",
      ],
      "latest-linux-arm64.yml": [
        "Agent-Native-arm64.AppImage",
        "Agent-Native-arm64.deb",
      ],
    };
    const manifestText = (files: string[]) =>
      [
        "version: 0.1.292",
        "files:",
        ...files.flatMap((file) => [
          `  - url: ${file}`,
          "    sha512: abc==",
          "    size: 1",
        ]),
        `path: ${files[0]}`,
        "sha512: abc==",
        "releaseDate: '2026-11-06T18:15:27.000Z'",
      ].join("\n");
    const runCheck = (
      assets: string[],
      manifestFiles: Record<string, string> = Object.fromEntries(
        Object.entries(manifests).map(([name, files]) => [
          name,
          manifestText(files),
        ]),
      ),
    ) => {
      const tempRoot = mkdtempSync(path.join(tmpdir(), "desktop-publish-"));
      const binDirectory = path.join(tempRoot, "bin");
      const manifestDirectory = path.join(tempRoot, "manifests");
      mkdirSync(binDirectory);
      mkdirSync(manifestDirectory);
      for (const [name, text] of Object.entries(manifestFiles)) {
        writeFileSync(path.join(manifestDirectory, name), text);
      }
      // `gh release download <tag> --pattern <name> --output -` prints one
      // manifest, and fails when the stub has none for that name.
      writeFileSync(
        path.join(binDirectory, "gh"),
        `#!/bin/sh
case "$1 $2" in
  "release view") printf '%s\\n' "$ASSETS" ;;
  "release download") cat "$MANIFESTS/$5" ;;
  *) exit 1 ;;
esac
`,
      );
      chmodSync(path.join(binDirectory, "gh"), 0o755);
      try {
        return spawnSync("bash", ["-eo", "pipefail", "-c", String(check.run)], {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
            ASSETS: assets.join("\n"),
            MANIFESTS: manifestDirectory,
            RELEASE_VERSION: "0.1.292",
            GITHUB_REPOSITORY: "BuilderIO/agent-native",
          },
        });
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    };
    const complete = [
      ...Object.keys(manifests),
      ...Object.values(manifests).flat(),
      "Agent-Native-x64.dmg",
      "Agent-Native-x64.tar.xz",
      "Agent-Native-arm64.tar.xz",
    ];

    const published = runCheck(complete);
    assert.equal(published.status, 0, published.stdout + published.stderr);

    const noMac = runCheck(
      complete.filter((name) => name !== "latest-mac.yml"),
    );
    assert.equal(noMac.status, 1);
    assert.match(noMac.stdout, /v0\.1\.292 is missing latest-mac\.yml,/);

    const noDmg = runCheck(
      complete.filter((name) => name !== "Agent-Native-arm64.dmg"),
    );
    assert.equal(noDmg.status, 1);
    assert.match(
      noDmg.stdout,
      /is missing Agent-Native-arm64\.dmg \*-arm64\.dmg,/,
    );

    const unreadable = runCheck(complete, {});
    assert.notEqual(unreadable.status, 0);
    assert.doesNotMatch(unreadable.stdout, /::error::Release/);

    const unrecognized = runCheck(complete, {
      ...Object.fromEntries(
        Object.entries(manifests).map(([name, files]) => [
          name,
          manifestText(files),
        ]),
      ),
      "latest.yml": "version: 0.1.292\n",
    });
    assert.equal(unrecognized.status, 1);
    assert.match(
      unrecognized.stdout,
      /latest\.yml in v0\.1\.292 lists no files/,
    );

    // The docs site offers the Linux archives, which no manifest lists.
    const noArchive = runCheck(
      complete.filter((name) => name !== "Agent-Native-arm64.tar.xz"),
    );
    assert.equal(noArchive.status, 1);
    assert.match(noArchive.stdout, /is missing \*-arm64\.tar\.xz,/);

    // latest-mac.yml here lists only the arm64 DMG, so only the download
    // check notices the x64 one is gone.
    const noIntelDmg = runCheck(
      complete.filter((name) => name !== "Agent-Native-x64.dmg"),
    );
    assert.equal(noIntelDmg.status, 1);
    assert.match(noIntelDmg.stdout, /is missing \*-x64\.dmg,/);
  });

  it("refuses to publish a Clips draft without its DMG, or with no builds", () => {
    const publishSteps = (
      (clipsWorkflow.jobs as Workflow)["publish-release"] as Workflow
    ).steps as Workflow[];
    const manifestStep = publishSteps.find(
      (step) =>
        step.name ===
        "Write the updater manifest from every build's signatures",
    );
    assert.ok(manifestStep);
    const flipIndex = publishSteps.findIndex(
      (step) => step.name === "Mark versioned release as published",
    );
    assert(publishSteps.indexOf(manifestStep) < flipIndex);

    // clips-v0.1.343 as published.
    const releaseAssets = [
      "Clips-0.1.343-1.x86_64.rpm",
      "Clips-0.1.343-1.x86_64.rpm.sig",
      "Clips_0.1.343_amd64.AppImage",
      "Clips_0.1.343_amd64.AppImage.sig",
      "Clips_0.1.343_amd64.deb",
      "Clips_0.1.343_amd64.deb.sig",
      "Clips_0.1.343_universal.app.tar.gz",
      "Clips_0.1.343_universal.app.tar.gz.sig",
      "Clips_0.1.343_universal.dmg",
      "Clips_0.1.343_x64_en-US.msi",
      "Clips_0.1.343_x64_en-US.msi.sig",
    ];
    const runManifestStep = (assets: string[], mode: string) => {
      const workspace = mkdtempSync(path.join(tmpdir(), "clips-publish-"));
      const binDirectory = path.join(workspace, "bin");
      const uploadsPath = path.join(workspace, "uploads.txt");
      mkdirSync(binDirectory);
      symlinkSync(
        path.join(process.cwd(), "scripts"),
        path.join(workspace, "scripts"),
      );
      writeFileSync(
        path.join(workspace, "release.json"),
        JSON.stringify({
          body: "Clips release notes",
          assets: assets.map((name) => ({
            name,
            apiUrl: `https://api.github.com/assets/${name}`,
          })),
        }),
      );
      // `gh release download --pattern '*.sig' --dir <dir>` writes every
      // signature; `gh release upload` records the manifest it was given.
      writeFileSync(
        path.join(binDirectory, "gh"),
        `#!/bin/sh
case "$1 $2" in
  "release view") cat "$WORKSPACE/release.json" ;;
  "release download")
    for name in $SIGNATURE_FILES; do printf 'signature of %s' "$name" > "$7/$name"; done ;;
  "release upload") echo "$4" >> "$UPLOADS" ;;
  *) exit 1 ;;
esac
`,
      );
      chmodSync(path.join(binDirectory, "gh"), 0o755);
      try {
        const result = spawnSync(
          "bash",
          ["-eo", "pipefail", "-c", String(manifestStep.run)],
          {
            cwd: workspace,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
              WORKSPACE: workspace,
              UPLOADS: uploadsPath,
              SIGNATURE_FILES: assets
                .filter((name) => name.endsWith(".sig"))
                .join(" "),
              RELEASE_TAG_PREFIX: "clips-v",
              RELEASE_VERSION: "0.1.343",
              RELEASE_MODE: mode,
            },
          },
        );
        const uploads = existsSync(uploadsPath)
          ? readFileSync(uploadsPath, "utf8")
          : "";
        const manifestPath = path.join(workspace, "updater", "latest.json");
        const manifest =
          existsSync(manifestPath) && result.status === 0
            ? (JSON.parse(readFileSync(manifestPath, "utf8")) as {
                platforms: Record<string, unknown>;
              })
            : null;
        return { result, uploads, manifest };
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    };

    for (const mode of ["release", "publish"]) {
      const complete = runManifestStep(releaseAssets, mode);
      assert.equal(complete.result.status, 0, complete.result.stderr);
      assert.equal(complete.uploads, "updater/latest.json\n");
      assert.deepEqual(Object.keys(complete.manifest?.platforms ?? {}).sort(), [
        "darwin-aarch64",
        "darwin-aarch64-app",
        "darwin-universal",
        "darwin-universal-app",
        "darwin-x86_64",
        "darwin-x86_64-app",
        "linux-x86_64",
        "linux-x86_64-appimage",
        "linux-x86_64-deb",
        "linux-x86_64-rpm",
        "windows-x86_64",
        "windows-x86_64-msi",
      ]);

      // A .deb install reads linux-x86_64-deb before the AppImage's key.
      const noDeb = runManifestStep(
        releaseAssets.filter((name) => !/\.deb(\.sig)?$/.test(name)),
        mode,
      );
      assert.equal(noDeb.result.status, 1);
      assert.match(
        noDeb.result.stderr,
        /no signed updater bundle for linux-x86_64-deb/,
      );
      assert.equal(noDeb.uploads, "");

      const noDmg = runManifestStep(
        releaseAssets.filter((name) => !name.endsWith(".dmg")),
        mode,
      );
      assert.equal(noDmg.result.status, 1);
      assert.match(noDmg.result.stdout, /clips-v0\.1\.343 has no \.dmg/);
      assert.equal(noDmg.uploads, "");
    }

    // Without signatures a publish run cannot tell a build from an empty
    // draft; a full release keeps publishing builds made without a key.
    const unsigned = releaseAssets.filter((name) => !name.endsWith(".sig"));
    const unsignedPublish = runManifestStep(unsigned, "publish");
    assert.equal(unsignedPublish.result.status, 1);
    assert.match(
      unsignedPublish.result.stdout,
      /clips-v0\.1\.343 has no \.sig files, so no build reached it/,
    );
    const unsignedRelease = runManifestStep(unsigned, "release");
    assert.equal(
      unsignedRelease.result.status,
      0,
      unsignedRelease.result.stderr,
    );
    assert.match(unsignedRelease.result.stdout, /writing no updater manifest/);
    assert.equal(unsignedRelease.uploads, "");
  });

  it("picks one patch past the newest published stable release", async () => {
    const repoRef = { owner: "BuilderIO", repo: "agent-native" };
    const clientWith = (
      releases: string[],
      drafts: string[],
      tags: string[],
    ) => ({
      paginate: async () => [
        ...releases.map((tag_name) => ({
          tag_name,
          draft: false,
          prerelease: tag_name.includes("-nightly."),
        })),
        ...drafts.map((tag_name) => ({
          tag_name,
          draft: true,
          prerelease: false,
        })),
      ],
      rest: {
        git: {
          getRef: async ({ ref }: { ref: string }) => {
            if (!tags.includes(ref.replace(/^tags\//, ""))) {
              throw Object.assign(new Error("Not Found"), { status: 404 });
            }
            return {
              data: { object: { type: "commit", sha: "c".repeat(40) } },
            };
          },
          getTag: async () => ({ data: { object: { sha: "c".repeat(40) } } }),
          createRef: async () => ({}),
        },
        repos: { listReleases: {} },
      },
    });
    const releases = [
      "v0.1.292",
      "v0.1.150-nightly.431",
      "v0.1.99",
      "clips-v0.1.500",
      "v-preview",
    ];

    assert.equal(
      await nextStableVersion(
        clientWith(releases, ["v0.1.300"], []),
        repoRef,
        "v",
        "0.1.200",
      ),
      "0.1.293",
    );
    // A newer package version wins over older releases.
    assert.equal(
      await nextStableVersion(
        clientWith(releases, [], []),
        repoRef,
        "v",
        "0.2.0",
      ),
      "0.2.1",
    );
    // Tags without a published release (reserved, or a draft's) are skipped.
    assert.equal(
      await nextStableVersion(
        clientWith(releases, ["v0.1.293"], ["v0.1.293", "v0.1.294"]),
        repoRef,
        "v",
        "0.1.200",
      ),
      "0.1.295",
    );
    assert.equal(
      await nextStableVersion(
        clientWith(releases, [], []),
        repoRef,
        "clips-v",
        "0.1.80",
      ),
      "0.1.501",
    );
    await assert.rejects(
      nextStableVersion(clientWith([], [], []), repoRef, "v", "0.1.2-beta"),
      /v base version has no exact stable semver: 0\.1\.2-beta/,
    );
  });

  it("reserves the next stable version when a stable desktop release has none", async () => {
    const releaseSha = "d".repeat(40);
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    const reserveSteps = [
      {
        workflow: desktopWorkflow,
        job: "resolve-version",
        tagPrefix: "v",
        packagePath: "packages/desktop-app",
      },
      {
        workflow: clipsWorkflow,
        job: "prepare-release",
        tagPrefix: "clips-v",
        packagePath: "templates/clips/desktop",
      },
    ];
    const workspace = mkdtempSync(path.join(tmpdir(), "desktop-version-"));
    const environment = {
      GITHUB_WORKSPACE: process.env.GITHUB_WORKSPACE,
      RELEASE_SOURCE_REF: process.env.RELEASE_SOURCE_REF,
      TAURI_APP_PATH: process.env.TAURI_APP_PATH,
    };
    try {
      // The step imports the script from a checkout of the workflow's revision.
      symlinkSync(process.cwd(), path.join(workspace, "workflow-revision"));
      for (const { workflow, job, tagPrefix, packagePath } of reserveSteps) {
        const jobSteps = ((workflow.jobs as Workflow)[job] as Workflow)
          .steps as Workflow[];
        const reserveIndex = jobSteps.findIndex(
          (step) => step.id === "reserve",
        );
        const reserve = jobSteps[reserveIndex];
        const checkout = jobSteps[reserveIndex - 1];
        assert.equal(reserve.name, "Reserve the next stable version");
        assert.equal(checkout.if, reserve.if);
        assert.deepEqual(checkout.with, {
          path: "workflow-revision",
          "sparse-checkout": "scripts",
          "persist-credentials": false,
        });

        mkdirSync(path.join(workspace, packagePath), { recursive: true });
        writeFileSync(
          path.join(workspace, packagePath, "package.json"),
          JSON.stringify({ version: "0.1.80" }),
        );
        process.env.GITHUB_WORKSPACE = workspace;
        process.env.RELEASE_SOURCE_REF = releaseSha;
        process.env.TAURI_APP_PATH = "templates/clips/desktop";
        const created: { ref: string; sha: string }[] = [];
        const outputs: Record<string, string> = {};
        await new AsyncFunction(
          "github",
          "context",
          "core",
          "require",
          String((reserve.with as Workflow).script),
        )(
          {
            paginate: async () => [
              {
                tag_name: `${tagPrefix}0.1.90`,
                draft: false,
                prerelease: false,
              },
            ],
            rest: {
              git: {
                getRef: async () => {
                  throw Object.assign(new Error("Not Found"), { status: 404 });
                },
                getTag: async () => ({}),
                createRef: async (request: { ref: string; sha: string }) => {
                  created.push({ ref: request.ref, sha: request.sha });
                },
              },
              repos: { listReleases: {} },
            },
          },
          { repo: { owner: "BuilderIO", repo: "agent-native" } },
          {
            info: () => {},
            warning: () => {},
            setOutput: (name: string, value: string) => {
              outputs[name] = value;
            },
          },
          createRequire(import.meta.url),
        );
        assert.deepEqual(created, [
          { ref: `refs/tags/${tagPrefix}0.1.91`, sha: releaseSha },
        ]);
        assert.deepEqual(outputs, { version: "0.1.91" });
      }
    } finally {
      for (const [name, value] of Object.entries(environment)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      rmSync(workspace, { recursive: true, force: true });
    }

    // Desktop reserves only when its version step chose none, and never for
    // a publish run, which needs the staged draft's version.
    const resolveJob = (desktopWorkflow.jobs as Workflow)[
      "resolve-version"
    ] as Workflow;
    const resolveSteps = resolveJob.steps as Workflow[];
    assert.equal(
      resolveSteps.find((step) => step.id === "reserve")?.if,
      "${{ steps.v.outputs.version == '' }}",
    );
    assert.equal(
      (resolveJob.outputs as Workflow).version,
      "${{ steps.v.outputs.version || steps.reserve.outputs.version }}",
    );
    // macOS ships bash 3.2, which has no ${var,,}; runners have bash 5.
    const resolveVersion = String(
      resolveSteps.find((step) => step.id === "v")?.run,
    ).replace(
      "${SOURCE_REF,,}",
      "$(printf '%s' \"$SOURCE_REF\" | tr '[:upper:]' '[:lower:]')",
    );
    assert.doesNotMatch(resolveVersion, /,,\}/);
    const runResolve = (mode: string, version = "") => {
      const outputDirectory = mkdtempSync(
        path.join(tmpdir(), "desktop-resolve-"),
      );
      const outputFile = path.join(outputDirectory, "output");
      writeFileSync(outputFile, "");
      try {
        const result = spawnSync(
          "bash",
          ["-eo", "pipefail", "-c", resolveVersion],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              GITHUB_OUTPUT: outputFile,
              GITHUB_SHA: releaseSha,
              RELEASE_CHANNEL: "production",
              RELEASE_MODE: mode,
              RELEASE_VERSION_INPUT: version,
              RELEASE_SOURCE_REF_INPUT: "",
            },
          },
        );
        return { result, output: readFileSync(outputFile, "utf8") };
      } finally {
        rmSync(outputDirectory, { recursive: true, force: true });
      }
    };
    for (const mode of ["release", "stage"]) {
      const { result, output } = runResolve(mode);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(output, `source_ref=${releaseSha}\n`);
    }
    const blankPublish = runResolve("publish");
    assert.equal(blankPublish.result.status, 1);
    assert.match(
      blankPublish.result.stdout,
      /Publish mode needs the version of the staged draft to publish/,
    );
    assert.equal(
      runResolve("publish", "0.1.91").output,
      `source_ref=${releaseSha}\nversion=0.1.91\n`,
    );

    const clipsSteps = (
      (clipsWorkflow.jobs as Workflow)["prepare-release"] as Workflow
    ).steps as Workflow[];
    assert.equal(
      clipsSteps.find((step) => step.id === "reserve")?.if,
      "${{ env.RELEASE_CHANNEL == 'production' && !inputs.version && inputs.mode != 'publish' }}",
    );
    assert.equal(
      (clipsSteps.find((step) => step.id === "version")?.env as Workflow)
        .RELEASE_VERSION_INPUT,
      "${{ inputs.version || steps.reserve.outputs.version }}",
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
    assert.match(desktopSourceText, /gh release view "\$TAG" --json isDraft/);
    assert.match(desktopSourceText, /TAG_SHA[\s\S]*needs\.resolve-version/);
    assert.match(clipsSourceText, /\.isDraft/);
    assert.match(clipsSourceText, /get_tag_sha\(\)/);
    assert.match(clipsSourceText, /TAG_SHA[\s\S]*RELEASE_SOURCE_REF/);
    assert.match(clipsSourceText, /SOURCE_REF,,/);
    assert.match(desktopSource, /source_ref.*steps\.v\.outputs\.source_ref/);
    assert.match(desktopSource, /full 40-character commit SHA/);
    assert.match(desktopSource, /needs\.resolve-version\.outputs\.source_ref/);
    assert.match(clipsSource, /resolve-source-ref/);
    assert.match(clipsSource, /full 40-character commit SHA/);
    assert.match(clipsSource, /needs\.resolve-source-ref\.outputs\.source_ref/);
    assert.match(clipsSource, /needs\.prepare-release\.outputs\.release_id/);
    assert.match(desktopSource, /--target \\"\$\{\{ needs\.resolve-version/);
    assert.match(clipsSourceText, /--target "\$RELEASE_SOURCE_REF"/);
  });
});
