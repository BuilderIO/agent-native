import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { parse } from "yaml";

import {
  DEFAULT_NPM_AVAILABILITY_TIMEOUT_MS,
  NPM_PUBLISH_PACKAGE_NAMES,
  ensureLocalRuntimeDependenciesAvailable,
  isAlreadyStaged,
  preparePackagesForTagging,
} from "./changeset-publish-sequential.ts";
import { packagesCoveredBy } from "./check-changeset.mjs";
import { parseReleasePullRequestPackageFiles } from "./list-release-pr-package-files.ts";
import {
  RELEASE_COORDINATOR_STEP_NAME,
  assertReleaseCoordinatorStepActive,
  selectActiveReleaseCoordinator,
} from "./release-coordinator.ts";
import {
  isMajorVersionPromotion,
  packageManifestVersion,
  packageManifestVersionChange,
} from "./release-package-version-policy.ts";
import {
  COORDINATED_RELEASE_CHECK_TIMEOUT_MS,
  DEFAULT_REQUIRED_CHECK_TIMEOUT_MS,
  evaluateRequiredChecks,
  requiredCheckTimeoutForEvent,
  requiredContextsFromRules,
  waitForRequiredChecks,
} from "./release-required-checks.ts";
import {
  gitBlobSha,
  syncCommunityQrBlobPins,
  syncCommunityQrCoreLock,
} from "./sync-community-qr-core-lock.ts";
import {
  assertCompletePullRequestFiles,
  assertCommunityQrFilePinsSynced,
  decodeGitHubContentResponse,
  parseCompletePullRequestFiles,
} from "./verify-community-qr-release-pin.ts";
import {
  assertReleaseOnlyPullRequestFiles,
  extractPullRequestFileNames,
} from "./verify-release-package-files.ts";

type Workflow = Record<string, unknown>;

const changesetsRequire = createRequire(
  createRequire(import.meta.url).resolve("@changesets/cli"),
);
const semver = changesetsRequire("semver") as {
  inc: (version: string, release: "patch") => string | null;
  satisfies: (version: string, range: string) => boolean;
};

const workflow = parse(
  readFileSync(".github/workflows/auto-publish.yml", "utf8"),
) as Workflow;
const publisherSource = readFileSync(
  "scripts/changeset-publish-sequential.ts",
  "utf8",
);
const releasePhaseWorkflowSource = readFileSync(
  ".github/workflows/release-everything-phase.yml",
  "utf8",
);
const ciLintJob = (
  parse(readFileSync(".github/workflows/ci.yml", "utf8")) as {
    jobs: Record<string, { name: string; steps: Workflow[] }>;
  }
).jobs.lint;
const trigger = workflow.on as Workflow;
const dispatch = trigger.workflow_dispatch as Workflow;
const inputs = dispatch.inputs as Workflow;
const jobs = workflow.jobs as Workflow;
const autoMergeWorkflow = parse(
  readFileSync(".github/workflows/auto-merge-version-packages.yml", "utf8"),
) as Workflow;

describe("npm package release workflow", () => {
  it("waits for every active main ruleset check before auto-merging a release PR", async () => {
    const required = ["Build", "Fast tests", "Lint & format"];
    const contexts = requiredContextsFromRules([
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: required.map((context) => ({
            context,
            integration_id: null,
          })),
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [{ context: "Build", integration_id: null }],
        },
      },
    ]);
    assert.deepEqual(contexts, required);
    assert.deepEqual(evaluateRequiredChecks(required, []), {
      status: "pending",
      missing: required,
      pending: [],
    });
    assert.deepEqual(
      evaluateRequiredChecks(required, [
        { name: "Build", bucket: "pass" },
        { name: "Fast tests", bucket: "pass" },
      ]),
      {
        status: "pending",
        missing: ["Lint & format"],
        pending: [],
      },
    );

    let now = 0;
    let reads = 0;
    await waitForRequiredChecks({
      readRequiredContexts: async () => required,
      readStatuses: async () => {
        reads += 1;
        if (reads === 1) return [];
        if (reads === 2) {
          return [
            { name: "Build", bucket: "pass" },
            { name: "Fast tests", bucket: "pass" },
          ];
        }
        return required.map((name) => ({ name, bucket: "pass" }));
      },
      sleep: async (ms) => {
        now += ms;
      },
      now: () => now,
      timeoutMs: 60_000,
      intervalMs: 15_000,
    });
    assert.equal(reads, 3);
    assert.deepEqual(
      evaluateRequiredChecks(
        required,
        required.map((name) => ({ name, bucket: "pass" })),
      ),
      { status: "passed" },
    );
  });

  it("fails closed when required checks fail, remain partial, or are unconfigured", async () => {
    const required = ["Build", "Fast tests"];
    assert.deepEqual(
      evaluateRequiredChecks(required, [
        { name: "Build", bucket: "fail" },
        { name: "Fast tests", bucket: "pending" },
      ]),
      {
        status: "failed",
        reason: "Required release PR checks are not green: Build.",
      },
    );
    assert.throws(
      () => requiredContextsFromRules([]),
      /No required status checks are configured for main/,
    );
    assert.throws(
      () =>
        requiredContextsFromRules([
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [{ context: " ", integration_id: null }],
            },
          },
        ]),
      /without a context name/,
    );
    assert.throws(
      () =>
        requiredContextsFromRules([
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [
                { context: "Build", integration_id: 15368 },
              ],
            },
          },
        ]),
      /bound to GitHub App 15368.*cannot verify check provenance/,
    );
    assert.deepEqual(
      requiredContextsFromRules([
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [{ context: "Build" }],
          },
        },
      ]),
      ["Build"],
    );

    let now = 0;
    await assert.rejects(
      waitForRequiredChecks({
        readRequiredContexts: async () => required,
        readStatuses: async () => [{ name: "Build", bucket: "pass" }],
        sleep: async (ms) => {
          now += ms;
        },
        now: () => now,
        timeoutMs: 30_000,
        intervalMs: 15_000,
      }),
      /Timed out waiting for required release PR checks: Fast tests \(not reported\)/,
    );
  });

  it("caps delayed required-check polling at the coordinator merge window", async () => {
    assert.match(
      releasePhaseWorkflowSource,
      /const deadline = phaseDeadline\(210 \* 60_000\);/,
    );
    assert.equal(
      requiredCheckTimeoutForEvent("pull_request"),
      COORDINATED_RELEASE_CHECK_TIMEOUT_MS,
    );
    assert.equal(COORDINATED_RELEASE_CHECK_TIMEOUT_MS, 210 * 60_000);
    let now = 0;
    await assert.rejects(
      waitForRequiredChecks({
        readRequiredContexts: async () => ["Build"],
        readStatuses: async () => [],
        sleep: async (ms) => {
          now += ms;
        },
        now: () => now,
        timeoutMs: requiredCheckTimeoutForEvent("pull_request"),
        intervalMs: 60 * 60_000,
      }),
      /Timed out waiting for required release PR checks: Build \(not reported\)/,
    );
    assert.equal(now, COORDINATED_RELEASE_CHECK_TIMEOUT_MS);
    assert.equal(
      requiredCheckTimeoutForEvent("workflow_dispatch"),
      DEFAULT_REQUIRED_CHECK_TIMEOUT_MS,
    );
    assert.equal(DEFAULT_REQUIRED_CHECK_TIMEOUT_MS, 240 * 60_000);
  });

  it("stops polling when the matching release coordinator ends", async () => {
    let now = 0;
    let coordinatorReads = 0;
    let statusReads = 0;
    await assert.rejects(
      waitForRequiredChecks({
        readRequiredContexts: async () => ["Build"],
        readStatuses: async () => {
          statusReads += 1;
          return [];
        },
        verifyCoordinator: async (expectedRunId) => {
          coordinatorReads += 1;
          if (coordinatorReads === 1) {
            assert.equal(expectedRunId, undefined);
            return 123;
          }
          assert.equal(expectedRunId, 123);
          throw new Error("Release everything coordinator run 123 ended.");
        },
        coordinatorCheckIntervalMs: 30_000,
        intervalMs: 15_000,
        sleep: async (ms) => {
          now += ms;
        },
        now: () => now,
      }),
      /Release everything coordinator run 123 ended/,
    );
    assert.equal(coordinatorReads, 2);
    assert.equal(statusReads, 2);
  });

  it("matches one in-progress coordinator to the release PR update", () => {
    const run = {
      id: 123,
      event: "schedule",
      head_branch: "main",
      run_started_at: "2026-10-23T10:00:00Z",
      status: "in_progress",
    };
    const pages = [{ workflow_runs: [run] }];
    assert.equal(
      selectActiveReleaseCoordinator(pages, "2026-10-23T10:01:00Z"),
      123,
    );
    assert.equal(
      selectActiveReleaseCoordinator(pages, "2026-10-23T10:01:00Z", 123),
      123,
    );
    assert.throws(
      () => selectActiveReleaseCoordinator(pages, "2026-10-23T09:58:00Z"),
      /does not match the release PR update/,
    );
    assert.throws(
      () =>
        selectActiveReleaseCoordinator(
          [{ workflow_runs: [run] }, { workflow_runs: [{ ...run, id: 124 }] }],
          "2026-10-23T10:01:00Z",
        ),
      /Expected one active Release everything coordinator/,
    );
    assert.throws(
      () =>
        selectActiveReleaseCoordinator(
          [{ workflow_runs: [] }],
          "2026-10-23T10:01:00Z",
        ),
      /returned 0/,
    );
  });

  it("requires the coordinator release step to remain active", () => {
    const activePages = [
      {
        jobs: [
          {
            name: "Release packages, desktop apps, and production sites",
            status: "in_progress",
            steps: [
              {
                name: RELEASE_COORDINATOR_STEP_NAME,
                status: "in_progress",
                conclusion: null,
              },
            ],
          },
        ],
      },
    ];
    assert.doesNotThrow(() =>
      assertReleaseCoordinatorStepActive(activePages, 123),
    );
    assert.doesNotThrow(() =>
      assertReleaseCoordinatorStepActive(
        [
          {
            jobs: [
              {
                name: "Run the prepare release phase",
                status: "in_progress",
                steps: [],
              },
            ],
          },
        ],
        123,
      ),
    );
    assert.throws(
      () =>
        assertReleaseCoordinatorStepActive(
          [
            {
              jobs: [
                {
                  name: "Run the prepare release phase",
                  status: "queued",
                  steps: [],
                },
              ],
            },
          ],
          123,
        ),
      /Expected one active release step/,
    );
    const preparePhaseJob = {
      name: "Run the prepare release phase",
      status: "completed",
      conclusion: "success",
      steps: [
        {
          name: RELEASE_COORDINATOR_STEP_NAME,
          status: "completed",
          conclusion: "success",
        },
      ],
    };
    const postMergePhaseJob = {
      name: "Run the post-merge release phase",
      status: "in_progress",
      steps: [
        {
          name: RELEASE_COORDINATOR_STEP_NAME,
          status: "in_progress",
          conclusion: null,
        },
      ],
    };
    const sequentialPhasePages = [
      { jobs: [preparePhaseJob, postMergePhaseJob] },
    ];
    assert.doesNotThrow(() =>
      assertReleaseCoordinatorStepActive([{ jobs: [preparePhaseJob] }], 123),
    );
    assert.doesNotThrow(() =>
      assertReleaseCoordinatorStepActive(
        [
          {
            jobs: [
              preparePhaseJob,
              {
                ...postMergePhaseJob,
                status: "queued",
                steps: [],
              },
            ],
          },
        ],
        123,
      ),
    );
    assert.doesNotThrow(() =>
      assertReleaseCoordinatorStepActive(sequentialPhasePages, 123),
    );
    assert.throws(
      () =>
        assertReleaseCoordinatorStepActive(
          [
            {
              jobs: [postMergePhaseJob, postMergePhaseJob],
            },
          ],
          123,
        ),
      /Expected one active release step.*returned 2/,
    );
    assert.throws(
      () =>
        assertReleaseCoordinatorStepActive(
          [
            {
              jobs: [
                {
                  name: "Release packages, desktop apps, and production sites",
                  status: "in_progress",
                  steps: [
                    {
                      name: RELEASE_COORDINATOR_STEP_NAME,
                      status: "completed",
                      conclusion: "failure",
                    },
                  ],
                },
              ],
            },
          ],
          123,
        ),
      /no longer performing the release step/,
    );
    assert.throws(
      () => assertReleaseCoordinatorStepActive([{ jobs: [] }], 123),
      /Expected one active release step/,
    );
  });

  it("does not miss a required check on a later main rules page", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "release-checks-"));
    const binDirectory = path.join(tempRoot, "bin");
    const ghPath = path.join(binDirectory, "gh");
    mkdirSync(binDirectory);
    writeFileSync(
      ghPath,
      `#!/bin/sh
set -eu
case "$1" in
  api)
    case " $* " in
      *" --paginate --slurp "*)
        printf '%s\\n' '[[{"type":"required_status_checks","parameters":{"required_status_checks":[{"context":"Build","integration_id":null}]}}],[{"type":"required_status_checks","parameters":{"required_status_checks":[{"context":"Fast tests","integration_id":null}]}}]]'
        ;;
      *)
        printf '%s\\n' '[{"type":"required_status_checks","parameters":{"required_status_checks":[{"context":"Build","integration_id":null}]}}]'
        ;;
    esac
    ;;
  pr)
    printf '%s\\n' '[{"name":"Build","bucket":"pass"},{"name":"Fast tests","bucket":"fail"}]'
    ;;
  *)
    exit 1
    ;;
esac
`,
    );
    chmodSync(ghPath, 0o755);

    try {
      assert.throws(
        () =>
          execFileSync(
            process.execPath,
            [
              "--experimental-strip-types",
              path.resolve("scripts/release-required-checks.ts"),
              "verify",
              "8102",
              "BuilderIO/agent-native",
            ],
            {
              cwd: process.cwd(),
              env: {
                ...process.env,
                PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
              },
            },
          ),
        (error: unknown) => {
          const commandError = error as { status?: number; stderr?: Buffer };
          assert.equal(commandError.status, 1);
          assert.match(String(commandError.stderr), /Fast tests/);
          return true;
        },
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("treats an unreported required-check set as pending", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "release-checks-empty-"));
    const binDirectory = path.join(tempRoot, "bin");
    const callsPath = path.join(tempRoot, "gh-status-calls.txt");
    const ghPath = path.join(binDirectory, "gh");
    mkdirSync(binDirectory);
    writeFileSync(
      ghPath,
      `#!/bin/sh
case "$1" in
  api)
    printf '%s\\n' '[[{"type":"required_status_checks","parameters":{"required_status_checks":[{"context":"Build","integration_id":null}]}}]]'
    ;;
  pr)
    calls=0
    if [ -f "$GH_CALLS_FILE" ]; then calls=$(cat "$GH_CALLS_FILE"); fi
    calls=$((calls + 1))
    printf '%s' "$calls" > "$GH_CALLS_FILE"
    if [ "$calls" -eq 1 ]; then
      printf '%s\\n' "gh: no required checks reported on the 'main' branch" >&2
      exit 1
    fi
    printf '%s' '[{"name":"Build","bucket":"fail"}]'
    ;;
  *) exit 1 ;;
esac
`,
    );
    chmodSync(ghPath, 0o755);

    try {
      assert.throws(
        () =>
          execFileSync(
            process.execPath,
            [
              "--experimental-strip-types",
              path.resolve("scripts/release-required-checks.ts"),
              "verify",
              "8102",
              "BuilderIO/agent-native",
            ],
            {
              cwd: process.cwd(),
              env: {
                ...process.env,
                PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
                GH_CALLS_FILE: callsPath,
              },
            },
          ),
        (error: unknown) => {
          const commandError = error as { status?: number; stderr?: Buffer };
          assert.equal(commandError.status, 1);
          assert.match(
            String(commandError.stderr),
            /Required release PR checks are missing or pending: Build/,
          );
          return true;
        },
      );
      assert.equal(readFileSync(callsPath, "utf8"), "1");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("waits only while the matching coordinator release step is active", () => {
    const tempRoot = mkdtempSync(
      path.join(tmpdir(), "release-coordinator-wait-"),
    );
    const binDirectory = path.join(tempRoot, "bin");
    const callsPath = path.join(tempRoot, "gh-calls.txt");
    const ghPath = path.join(binDirectory, "gh");
    mkdirSync(binDirectory);
    writeFileSync(
      ghPath,
      `#!/bin/sh
printf '%s|%s\\n' "$GH_TOKEN" "$*" >> "$GH_CALLS_FILE"
case " $* " in
  *" repos/BuilderIO/agent-native/actions/workflows/release-everything.yml/runs?branch=main&status=in_progress&per_page=100 "*) printf '%s' "$GH_RUN_PAGES" ;;
  *" repos/BuilderIO/agent-native/actions/runs/123/jobs?per_page=100 "*) printf '%s' "$GH_JOB_PAGES" ;;
  *" repos/BuilderIO/agent-native/rules/branches/main "*) printf '%s' "$GH_RULE_PAGES" ;;
  *" pr checks 8102 --repo BuilderIO/agent-native --required --json name,bucket "*) printf '%s' '[{"name":"Build","bucket":"pass"}]' ;;
  *) printf '%s\\n' 'unexpected gh arguments' >&2; exit 1 ;;
esac
`,
    );
    chmodSync(ghPath, 0o755);

    const run = {
      id: 123,
      event: "schedule",
      head_branch: "main",
      run_started_at: "2026-10-23T10:00:00Z",
      status: "in_progress",
    };
    const jobs = [
      {
        name: "Release packages, desktop apps, and production sites",
        status: "in_progress",
        steps: [
          {
            name: RELEASE_COORDINATOR_STEP_NAME,
            status: "in_progress",
            conclusion: null,
          },
        ],
      },
    ];
    const env = {
      ...process.env,
      PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
      GH_TOKEN: "workflow-token",
      GH_ACTIONS_TOKEN: "actions-read-token",
      GH_CALLS_FILE: callsPath,
      GH_RUN_PAGES: JSON.stringify([{ workflow_runs: [run] }]),
      GH_JOB_PAGES: JSON.stringify([{ jobs }]),
      GH_RULE_PAGES: JSON.stringify([
        [
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [
                { context: "Build", integration_id: null },
              ],
            },
          },
        ],
      ]),
      PR_NUMBER: "8102",
      REPO: "BuilderIO/agent-native",
      RELEASE_EVENT_NAME: "pull_request",
      PR_UPDATED_AT: "2026-10-23T10:01:00Z",
      EXPECTED_COORDINATOR_RUN_ID: "",
    };
    const runWait = () =>
      execFileSync(
        process.execPath,
        [
          "--experimental-strip-types",
          path.resolve("scripts/release-required-checks.ts"),
          "wait",
          "8102",
          "BuilderIO/agent-native",
        ],
        { cwd: process.cwd(), encoding: "utf8", env },
      );

    try {
      assert.equal(runWait(), "123\n");
      assert.deepEqual(readFileSync(callsPath, "utf8").trim().split("\n"), [
        "actions-read-token|api --paginate --slurp repos/BuilderIO/agent-native/actions/workflows/release-everything.yml/runs?branch=main&status=in_progress&per_page=100",
        "actions-read-token|api --paginate --slurp repos/BuilderIO/agent-native/actions/runs/123/jobs?per_page=100",
        "workflow-token|api --paginate --slurp repos/BuilderIO/agent-native/rules/branches/main",
        "workflow-token|pr checks 8102 --repo BuilderIO/agent-native --required --json name,bucket",
      ]);

      writeFileSync(callsPath, "");
      env.RELEASE_EVENT_NAME = "workflow_dispatch";
      delete (env as { PR_UPDATED_AT?: string }).PR_UPDATED_AT;
      assert.equal(runWait(), "");
      assert.deepEqual(readFileSync(callsPath, "utf8").trim().split("\n"), [
        "workflow-token|api --paginate --slurp repos/BuilderIO/agent-native/rules/branches/main",
        "workflow-token|pr checks 8102 --repo BuilderIO/agent-native --required --json name,bucket",
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("retries transient GitHub command failures while reading rules and checks", async () => {
    const required = ["Build"];
    const commandFailure = () =>
      Object.assign(new Error("GitHub request failed"), {
        status: 1,
        stderr: "HTTP 503",
      });
    const delays: number[] = [];
    let contextReads = 0;
    let statusReads = 0;

    await waitForRequiredChecks({
      readRequiredContexts: async () => {
        contextReads += 1;
        if (contextReads === 1) throw commandFailure();
        return required;
      },
      readStatuses: async () => {
        statusReads += 1;
        if (statusReads === 1) throw commandFailure();
        return [{ name: "Build", bucket: "pass" }];
      },
      sleep: async (ms) => {
        delays.push(ms);
      },
      readRetryDelaysMs: [5, 10],
    });

    assert.equal(contextReads, 2);
    assert.equal(statusReads, 2);
    assert.deepEqual(delays, [5, 5]);
  });

  it("fails with the GitHub error after bounded retries are exhausted", async () => {
    const commandFailure = () =>
      Object.assign(new Error("GitHub request failed"), {
        status: 1,
        stderr: "HTTP 503",
      });
    let reads = 0;
    let now = 0;

    await assert.rejects(
      waitForRequiredChecks({
        readRequiredContexts: async () => ["Build"],
        readStatuses: async () => {
          reads += 1;
          throw commandFailure();
        },
        sleep: async (ms) => {
          now += ms;
        },
        now: () => now,
        readRetryDelaysMs: [1, 2],
      }),
      /Reading required release PR check results failed after 3 attempts: HTTP 503/,
    );
    assert.equal(reads, 3);
    assert.equal(now, 3);
  });

  it("allows a modified private app manifest without a package version", () => {
    assert.equal(
      packageManifestVersionChange(
        "templates/community/qr/package.json",
        "modified",
        { version: null },
        { version: null },
      ),
      null,
    );
  });

  it("distinguishes an omitted package version from an invalid null version", () => {
    assert.deepEqual(packageManifestVersion({ name: "qr" }), {
      version: null,
    });
    assert.throws(
      () => packageManifestVersion({ name: "qr", version: null }),
      /invalid package version/,
    );
  });

  it("still rejects missing manifests and version fields that appear or disappear", () => {
    for (const [before, after] of [
      [{ version: null }, { version: "1.0.0" }],
      [{ version: "1.0.0" }, { version: null }],
    ]) {
      assert.throws(
        () =>
          packageManifestVersionChange(
            "templates/community/qr/package.json",
            "modified",
            before,
            after,
          ),
        /Could not verify package manifest versions/,
      );
    }
    assert.throws(
      () =>
        packageManifestVersionChange(
          "packages/core/package.json",
          "modified",
          { version: "0.216.0" },
          null,
        ),
      /Could not verify package manifest versions/,
    );
  });

  it("does not allow adding or removing a versionless package manifest", () => {
    assert.throws(
      () =>
        packageManifestVersionChange(
          "templates/community/qr/package.json",
          "added",
          null,
          { version: null },
        ),
      /Could not verify added package manifest/,
    );
    assert.throws(
      () =>
        packageManifestVersionChange(
          "templates/community/qr/package.json",
          "removed",
          { version: null },
          null,
        ),
      /Could not verify removed package manifest/,
    );
  });

  it("keeps the major-promotion check for versioned package manifests", () => {
    assert.equal(isMajorVersionPromotion("0.216.0", "1.0.0"), true);
    assert.equal(isMajorVersionPromotion("0.216.0", "0.217.0"), false);
  });

  it("offers an explicit stable bump with patch as the default", () => {
    assert.deepEqual(inputs.releaseType, {
      description: "Stable release bump for all public npm packages",
      required: true,
      type: "choice",
      options: ["patch", "minor", "major"],
      default: "patch",
    });
  });

  it("publishes nightly snapshots, never beta snapshots or tags", () => {
    const nightly = jobs["publish-nightly"] as Workflow;
    const source = JSON.stringify(nightly);
    const publishStep = (nightly.steps as Workflow[]).find(
      (step) => step.name === "Publish nightly packages sequentially",
    );
    assert(publishStep);

    assert.match(String(nightly.if), /github\.event_name == 'schedule'/);
    assert.doesNotMatch(String(nightly.if), /github\.event_name == 'push'/);
    assert.deepEqual(nightly.needs, ["detect-nightly-changes"]);
    assert.match(
      String(nightly.if),
      /needs\.detect-nightly-changes\.outputs\.changed == 'true'/,
    );
    assert.doesNotMatch(
      String(nightly.if),
      /contains\(github\.event\.head_commit\.message/,
    );
    assert.match(source, /--snapshot nightly/);
    assert.equal(
      (publishStep.env as Workflow).AGENT_NATIVE_NPM_DIST_TAG,
      "nightly",
    );
    assert.doesNotMatch(source, /--snapshot beta/);
    assert.doesNotMatch(source, /AGENT_NATIVE_NPM_DIST_TAG: beta/);
  });

  it("publishes nightly snapshots on a three-hour schedule, not per merge", () => {
    assert.deepEqual(trigger.schedule, [{ cron: "17 */3 * * *" }]);

    const detect = jobs["detect-nightly-changes"] as Workflow;
    assert.match(String(detect.if), /github\.event_name == 'schedule'/);
    const detectStep = (detect.steps as Workflow[]).find(
      (step) => step.id === "detect",
    );
    assert(detectStep);
    const detectSource = String(detectStep.run);
    assert.match(detectSource, /event=schedule&branch=main&status=success/);
    assert.match(detectSource, /git diff --quiet "\$last_sha" HEAD/);

    const nightlyPaths = String((detectStep.env as Workflow).NIGHTLY_PATHS)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const push = trigger.push as { paths: string[] };
    assert.deepEqual(nightlyPaths, push.paths);
  });

  it("skips the stable verifier on ordinary pushes", () => {
    const verifier = jobs["verify-stable-merge"] as Workflow;
    assert.match(
      String(verifier.if),
      /github\.event_name == 'workflow_dispatch'/,
    );
    assert.match(
      String(verifier.if),
      /contains\(github\.event\.head_commit\.message, '\[stable-release\]'\)/,
    );
  });

  it("rejects a marked ordinary push from the stable lane", () => {
    const verifier = jobs["verify-stable-merge"] as Workflow;
    const release = jobs.release as Workflow;

    assert.doesNotMatch(String(release.if), /head_commit\.message/);
    assert.match(
      String(release.if),
      /needs\.verify-stable-merge\.outputs\.verified == 'true'/,
    );
    assert.match(JSON.stringify(verifier), /stable_marker/);
    assert.match(JSON.stringify(verifier), /ACTOR/);
    assert.match(JSON.stringify(verifier), /commits\/\$SHA\/pulls/);
  });

  it("keeps stable releases behind a manual dispatch or marked merge", () => {
    const verifier = jobs["verify-stable-merge"] as Workflow;
    const verifierSource = JSON.stringify(verifier);
    const release = jobs.release as Workflow;
    const condition = String(release.if);
    const notify = jobs["notify-downstream"] as Workflow;

    assert.match(
      condition,
      /needs\.verify-stable-merge\.outputs\.verified == 'true'/,
    );
    assert.match(verifierSource, /commits\/\$SHA\/pulls/);
    assert.match(verifierSource, /changeset-release\/main/);
    assert.match(verifierSource, /builder-io-integration\[bot\]/);
    assert.match(verifierSource, /merge_commit_sha == \$sha/);
    assert.deepEqual(notify.needs, ["release", "verify-stable-merge"]);
    assert.match(
      String(notify.if),
      /github\.event_name == 'workflow_dispatch'/,
    );
    assert.match(
      String(notify.if),
      /needs\.verify-stable-merge\.outputs\.verified == 'true'/,
    );
  });

  it("uses calculated semver bases for nightly snapshots", () => {
    const config = JSON.parse(
      readFileSync(".changeset/config.json", "utf8"),
    ) as { snapshot?: { useCalculatedVersion?: boolean } };

    assert.equal(config.snapshot?.useCalculatedVersion, true);
  });

  it("supports the next fixed-group Core patch without the incompatible gap release", () => {
    const corePackage = JSON.parse(
      readFileSync("packages/core/package.json", "utf8"),
    ) as { version: string; exports?: Record<string, unknown> };
    const toolkitPackage = JSON.parse(
      readFileSync("packages/toolkit/package.json", "utf8"),
    ) as {
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };
    const changesetConfig = JSON.parse(
      readFileSync(".changeset/config.json", "utf8"),
    ) as { fixed?: string[][] };

    assert.ok(corePackage.exports?.["./shared"]);
    assert.ok(
      changesetConfig.fixed?.some(
        (group) =>
          group.includes("@agent-native/core") &&
          group.includes("@agent-native/toolkit"),
      ),
    );
    const corePeerRange =
      toolkitPackage.peerDependencies?.["@agent-native/core"];
    assert.ok(corePeerRange);

    const acceptsNextCorePatch = (coreVersion: string) => {
      const nextCorePatch = semver.inc(coreVersion, "patch");
      return (
        nextCorePatch !== null && semver.satisfies(nextCorePatch, corePeerRange)
      );
    };

    for (const coreVersion of [corePackage.version, "0.205.0"]) {
      assert.ok(
        acceptsNextCorePatch(coreVersion),
        `Toolkit must accept the next fixed-group Core patch after ${coreVersion}`,
      );
    }

    for (const coreVersion of ["0.204.0", "0.205.0"]) {
      assert.equal(
        semver.satisfies(coreVersion, corePeerRange),
        false,
        `Toolkit must not accept published Core ${coreVersion} without the sanitizer export`,
      );
    }

    assert.equal(
      semver.satisfies("0.204.1", corePeerRange),
      false,
      "Toolkit must require Core 0.205.1, which first includes the session slot export",
    );

    for (const coreVersion of ["0.205.1"]) {
      assert.ok(
        semver.satisfies(coreVersion, corePeerRange),
        `Toolkit must accept Core ${coreVersion} with the session slot export`,
      );
    }

    assert.equal(
      toolkitPackage.peerDependenciesMeta?.["@agent-native/core"]?.optional,
      true,
    );
  });

  it("keeps the release changeset package list aligned with the publisher", () => {
    const source = readFileSync("scripts/create-release-changeset.ts", "utf8");
    assert.match(source, /NPM_PUBLISH_PACKAGE_NAMES/);
    assert.equal(NPM_PUBLISH_PACKAGE_NAMES.length, 11);
  });

  it("allows npm propagation to settle before failing a publish", () => {
    assert.equal(DEFAULT_NPM_AVAILABILITY_TIMEOUT_MS, 30 * 60_000);
    assert.match(publisherSource, /preparePackagesForTagging\(/);
  });

  it("waits for npm staged versions to become fetchable before tagging", () => {
    const stagedConflict =
      'npm error code E409\nnpm error 409 Conflict - PUT https://registry.npmjs.org/@agent-native%2fdispatch - Cannot publish over previously staged version "0.38.7".';

    assert.equal(isAlreadyStaged(stagedConflict), true);
    assert.equal(
      isAlreadyStaged("npm error code E409\nnpm error 409 Conflict"),
      false,
    );
    assert.match(
      publisherSource,
      /if \(isAlreadyStaged\(output\)\)[\s\S]*?return true;/,
    );
  });

  it("validates Changesets YAML frontmatter", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agent-native-changeset-"));
    const changeset = path.join(dir, "invalid.md");

    try {
      writeFileSync(changeset, "Not a changeset\n");
      assert.throws(
        () => packagesCoveredBy(changeset),
        /expected YAML frontmatter between --- lines/,
      );

      writeFileSync(
        changeset,
        '---\n"@agent-native/core": nonsense\n---\nInvalid bump\n',
      );
      assert.throws(
        () => packagesCoveredBy(changeset),
        /expected package entries with none, patch, minor, or major bumps/,
      );

      writeFileSync(
        changeset,
        '---\n"@agent-native/core": patch\n---not-a-closing-delimiter\n',
      );
      assert.throws(
        () => packagesCoveredBy(changeset),
        /expected YAML frontmatter between --- lines/,
      );

      writeFileSync(
        changeset,
        '---\n"@agent-native/core": patch\n"@agent-native/core": minor\n---\n',
      );
      assert.throws(
        () => packagesCoveredBy(changeset),
        /invalid YAML frontmatter/,
      );

      writeFileSync(changeset, "---\n- patch\n---\n");
      assert.throws(
        () => packagesCoveredBy(changeset),
        /expected a YAML package-to-bump map/,
      );

      writeFileSync(
        changeset,
        '---\n"@agent-native/core": "patch" # release\n"@agent-native/dispatch": none\n"@agent-native/pinpoint": minor\n"@agent-native/toolkit": major\n---\nValid bumps\n',
      );
      assert.deepEqual(packagesCoveredBy(changeset), [
        "@agent-native/core",
        "@agent-native/dispatch",
        "@agent-native/pinpoint",
        "@agent-native/toolkit",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("installs the YAML parser before checking changesets in CI", () => {
    assert.equal(ciLintJob.name, "Lint & format");
    const steps = ciLintJob.steps;
    const install = steps.findIndex(
      (step) => step.uses === "./.github/actions/setup-pnpm",
    );
    const check = steps.findIndex(
      (step) => step.run === "node scripts/check-changeset.mjs",
    );
    const bumpPolicy = steps.findIndex(
      (step) => step.run === "node scripts/guard-no-major-changeset.mjs",
    );
    assert.ok(install >= 0 && install < check && check < bumpPolicy);
    for (const index of [check, bumpPolicy]) {
      const condition = String(steps[index].if);
      assert.match(
        condition,
        /needs\.change-scope\.outputs\.changeset == 'true'/,
      );
      assert.match(condition, /head\.ref != 'changeset-release\/main'/);
    }
    assert.equal(
      (steps[check].env as Workflow).GITHUB_BASE_REF,
      "${{ github.base_ref }}",
    );
  });

  it("consumes concurrent public changesets after stable publication", () => {
    const release = jobs.release as Workflow;
    const releaseSteps = release.steps as Workflow[];
    const build = releaseSteps.find(
      (step) => step.name === "Build publishable packages",
    );
    assert(build);
    const buildFilters = [
      ...String(build.run).matchAll(/--filter\s+([^\s]+)/g),
    ].map((match) => match[1].replace(/^['"]|['"]$/g, ""));
    assert.deepEqual(
      buildFilters,
      NPM_PUBLISH_PACKAGE_NAMES.map((name) => `${name}...`),
    );

    const hold = releaseSteps.find(
      (step) => step.name === "Hold pending changesets for stable publication",
    );
    assert(hold);
    const policy = releaseSteps.find(
      (step) => step.name === "Enforce package bump policy",
    );
    assert(policy);
    assert.equal(policy.run, "node scripts/guard-no-major-changeset.mjs");
    assert.match(String(hold.if), /github\.event_name == 'push'/);
    assert.match(JSON.stringify(hold), /RUNNER_TEMP/);
    assert.match(String(hold.run), /changeset status --output/);
    assert.match(JSON.stringify(hold), /README\.md/);
    for (const packageName of NPM_PUBLISH_PACKAGE_NAMES) {
      assert.match(
        String(hold.run),
        new RegExp(packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }

    const changesets = releaseSteps.find(
      (step) => step.name === "Create stable Release PR or publish to npm",
    );
    assert(changesets);
    const options = changesets.with as Workflow;
    assert.equal(options.version, "pnpm changeset:release-version");
    assert.equal(options["version-script"], undefined);
    const packageScripts = JSON.parse(readFileSync("package.json", "utf8"))
      .scripts as Record<string, string>;
    assert.equal(
      packageScripts["changeset:release-version"],
      "pnpm changeset:version && pnpm exec tsx scripts/sync-community-qr-core-lock.ts && pnpm changelog:compact",
    );

    const consume = releaseSteps.find(
      (step) => step.name === "Consume concurrent public-package changesets",
    );
    assert(consume);
    assert.match(String(consume.if), /github\.event_name == 'push'/);
    assert.match(String(consume.if), /steps\.changesets\.outcome == 'success'/);
    assert.match(String(consume.run), /git push origin HEAD:main/);
    assert.match(String(consume.run), /main:refs\/remotes\/origin\/main/);
    assert.match(String(consume.run), /git rebase --autostash origin\/main/);
    assert.match(String(consume.run), /git diff --name-only --diff-filter=U/);
    assert.match(
      String(consume.run),
      /Autostash restoration conflicted after rebase/,
    );
    assert.match(String(consume.run), /git cat-file -e/);
    assert.match(String(consume.run), /\[skip ci\]/);

    const restore = releaseSteps.find(
      (step) => step.name === "Restore pending changesets",
    );
    assert(restore);
    assert.match(String(restore.if), /always\(\)/);
    assert.match(String(restore.run), /consume-stable-changesets\.outcome/);

    const validateIndex = releaseSteps.findIndex(
      (step) => step.name === "Validate changesets",
    );
    const holdIndex = releaseSteps.indexOf(hold);
    const policyIndex = releaseSteps.indexOf(policy);
    const changesetsIndex = releaseSteps.indexOf(changesets);
    const consumeIndex = releaseSteps.indexOf(consume);
    const restoreIndex = releaseSteps.indexOf(restore);
    assert(holdIndex < validateIndex);
    assert(policyIndex < holdIndex);
    assert(holdIndex < changesetsIndex);
    assert(changesetsIndex < consumeIndex);
    assert(consumeIndex < restoreIndex);
    assert(changesetsIndex < restoreIndex);
  });

  it("syncs the community QR release importer to the in-repo Core package", () => {
    const lockfile = `lockfileVersion: '9.0'
importers:
  templates/community/qr:
    dependencies:
      '@agent-native/core':
        specifier: ^0.212.0
        version: 0.212.0(425ad63e441766c7cc702a9e78bce500)
      postgres:
        specifier: ^3.4.9
        version: 3.4.9

  templates/analytics:
    dependencies: {}
`;

    const updated = syncCommunityQrCoreLock(lockfile, "^0.213.0");

    assert.match(
      updated,
      /specifier: \^0\.213\.0\n        version: link:\.\.\/\.\.\/\.\.\/packages\/core/,
    );
    assert.match(updated, /specifier: \^3\.4\.9\n        version: 3\.4\.9/);
    assert.match(updated, /  templates\/analytics:\n    dependencies: \{\}/);
    assert.equal(syncCommunityQrCoreLock(updated, "^0.213.0"), updated);
    assert.throws(
      () => syncCommunityQrCoreLock("importers: {}\n", "^0.213.0"),
      /Missing templates\/community\/qr importer/,
    );
  });

  it("keeps the committed community QR importer synced with its manifest", () => {
    const templatePackage = JSON.parse(
      readFileSync("templates/community/qr/package.json", "utf8"),
    ) as { dependencies?: Record<string, unknown> };
    const coreSpecifier = templatePackage.dependencies?.["@agent-native/core"];
    assert(typeof coreSpecifier === "string");

    const lockfile = readFileSync("pnpm-lock.yaml", "utf8");
    assert.equal(syncCommunityQrCoreLock(lockfile, coreSpecifier), lockfile);
  });

  it("rewrites the QR template blob pins from the files on disk", () => {
    const source = `templatePath: "templates/other-first",
      files: [
        {
          path: "package.json",
          blobSha: "${"d".repeat(40)}",
        },
      ],
    },
    {
      templatePath: "templates/community/qr",
      files: [
        {
          path: "package.json",
          blobSha: "${"a".repeat(40)}",
        },
        {
          path: "README.md",
          blobSha: "${"b".repeat(40)}",
        },
      ],
    },
    {
      templatePath: "templates/other",
      files: [
        {
          path: "package.json",
          blobSha: "${"c".repeat(40)}",
        },
      ],
    },`;

    const updated = syncCommunityQrBlobPins(source, (file) =>
      file === "package.json" ? "1".repeat(40) : "2".repeat(40),
    );

    assert.match(updated, /package\.json",\n\s+blobSha: "1{40}"/);
    assert.match(updated, /README\.md",\n\s+blobSha: "2{40}"/);
    assert.match(updated, /blobSha: "c{40}"/);
    assert.match(updated, /blobSha: "d{40}"/);
    assert.equal(
      syncCommunityQrBlobPins(updated, (file) =>
        file === "package.json" ? "1".repeat(40) : "2".repeat(40),
      ),
      updated,
    );
    assert.throws(
      () => syncCommunityQrBlobPins("export {};\n", () => "x"),
      /Missing templates\/community\/qr source/,
    );
    assert.equal(
      gitBlobSha(Buffer.from("hello\n")),
      "ce013625030ba8dba906f756967f9e9ca394464a",
    );
  });

  it("accepts all synchronized community QR template pins and rejects other catalog changes", () => {
    const basePackage = Buffer.from('{"name":"qr","version":"0.40.35"}\n');
    const headPackage = Buffer.from('{"name":"qr","version":"0.40.36"}\n');
    const headReadme = Buffer.from("updated QR template docs\n");
    const headAction = Buffer.from("updated QR action\n");
    const source = (pins: Map<string, string>) => `
      templatePath: "templates/community/qr",
      files: [
        ${["package.json", "README.md", "actions/run.ts"]
          .map(
            (path) => `{
          path: "${path}",
          blobSha: "${pins.get(path)}",
        }`,
          )
          .join(",\n        ")},
      ],
    },`;
    const baseSource = source(
      new Map([
        ["package.json", gitBlobSha(basePackage)],
        ["README.md", "b".repeat(40)],
        ["actions/run.ts", "d".repeat(40)],
      ]),
    );
    const headFiles = new Map([
      ["package.json", headPackage],
      ["README.md", headReadme],
      ["actions/run.ts", headAction],
    ]);
    const headPins = new Map(
      [...headFiles].map(([path, content]) => [path, gitBlobSha(content)]),
    );
    const headSource = source(headPins);

    assert.doesNotThrow(() =>
      assertCommunityQrFilePinsSynced(baseSource, headSource, headPins),
    );
    assert.throws(
      () =>
        assertCommunityQrFilePinsSynced(
          baseSource,
          source(new Map(headPins).set("package.json", "c".repeat(40))),
          headPins,
        ),
      /Head QR template blob pin does not match package.json/,
    );
    assert.throws(
      () =>
        assertCommunityQrFilePinsSynced(
          baseSource,
          headSource,
          new Map([...headPins].filter(([path]) => path !== "README.md")),
        ),
      /Missing head QR template blob for README.md/,
    );
    assert.throws(
      () =>
        assertCommunityQrFilePinsSynced(
          baseSource,
          headSource.replace(
            'templatePath: "templates/community/qr",',
            'templatePath: "templates/community/qr",\n      description: "unexpected",',
          ),
          headPins,
        ),
      /Community app catalog does not match the synchronized QR template file pins/,
    );
  });

  it("rejects incomplete or capped pull request file listings", () => {
    assert.deepEqual(assertCompletePullRequestFiles(["one", "two"], 2), [
      "one",
      "two",
    ]);
    assert.throws(
      () => assertCompletePullRequestFiles(["one"], 2),
      /GitHub returned 1 of 2 changed pull request files/,
    );
    assert.throws(
      () => assertCompletePullRequestFiles([], 3_000),
      /endpoint is capped at 3000/,
    );
  });

  it("rejects pull request file lists at GitHub's 3,000-file cap", () => {
    const belowLimit = Array.from(
      { length: 2_999 },
      (_, index) => `file-${index}.txt`,
    ).join("\n");
    const atLimit = Array.from(
      { length: 3_000 },
      (_, index) => `file-${index}.txt`,
    ).join("\n");

    assert.equal(parseCompletePullRequestFiles(belowLimit).length, 2_999);
    assert.throws(
      () => parseCompletePullRequestFiles(atLimit),
      /pull request files API reached its 3,000-file limit/,
    );
  });

  it("checks complete release paths as filenames and rejects embedded newlines", () => {
    const allowedFiles = [
      ".changeset/release.md",
      "packages/core/package.json",
      "packages/dispatch/src/server/lib/community-apps.ts",
    ];
    assert.deepEqual(
      assertReleaseOnlyPullRequestFiles(allowedFiles, allowedFiles.length),
      allowedFiles,
    );
    assert.throws(
      () =>
        assertReleaseOnlyPullRequestFiles(
          [".changeset/release.md\npackages/core/package.json"],
          1,
        ),
      /filename with control characters/,
    );
    assert.throws(
      () => assertReleaseOnlyPullRequestFiles(["README.md"], 1),
      /unexpected release PR path/,
    );
    assert.throws(
      () => assertReleaseOnlyPullRequestFiles(["package.json"], 2),
      /returned 1 of 2 changed pull request files/,
    );
    assert.throws(
      () => assertReleaseOnlyPullRequestFiles([], 3_000),
      /endpoint is capped at 3000/,
    );
  });

  it("collects filenames from every paginated GitHub file response", () => {
    assert.deepEqual(
      extractPullRequestFileNames([
        [{ filename: ".changeset/release.md" }],
        [
          { filename: "package.json" },
          { filename: "packages/core/CHANGELOG.md" },
        ],
      ]),
      [".changeset/release.md", "package.json", "packages/core/CHANGELOG.md"],
    );
    assert.throws(
      () => extractPullRequestFileNames([[{ filename: 1 }]]),
      /invalid pull request file list/,
    );
  });

  it("rejects unreadable or incomplete GitHub Contents API responses", () => {
    const content = Buffer.from("manifest");
    assert.deepEqual(
      decodeGitHubContentResponse(
        {
          encoding: "base64",
          content: content.toString("base64"),
          size: content.length,
        },
        "manifest.json",
        "head-sha",
      ),
      content,
    );

    assert.throws(
      () =>
        decodeGitHubContentResponse(
          { encoding: "none", content: "", size: 1_048_577 },
          "manifest.json",
          "head-sha",
        ),
      /GitHub returned unreadable file content/,
    );
    assert.throws(
      () =>
        decodeGitHubContentResponse(
          { encoding: "base64", content: "%%%", size: 3 },
          "manifest.json",
          "head-sha",
        ),
      /GitHub returned invalid base64 content/,
    );
    assert.throws(
      () =>
        decodeGitHubContentResponse(
          { encoding: "base64", content: "bWFuaWZlc3Q=", size: 99 },
          "manifest.json",
          "head-sha",
        ),
      /GitHub returned incomplete file content/,
    );
  });

  it("rejects pull request file lists at GitHub's 3,000-file cap", () => {
    const belowLimit = Array.from(
      { length: 2_999 },
      (_, index) => `file-${index}.txt`,
    ).join("\n");
    const atLimit = Array.from(
      { length: 3_000 },
      (_, index) => `file-${index}.txt`,
    ).join("\n");

    assert.equal(parseCompletePullRequestFiles(belowLimit).length, 2_999);
    assert.throws(
      () => parseCompletePullRequestFiles(atLimit),
      /pull request files API reached its 3,000-file limit/,
    );
  });

  it("runs both release verifier CLIs through the shared file request", () => {
    const files = [
      { filename: "packages/core/package.json", status: "modified" },
      { filename: ".changeset/core-fix.md", status: "added" },
      { filename: "packages/core/CHANGELOG.md", status: "modified" },
    ];
    const pages = JSON.stringify([[files[0], files[1]], [files[2]]]);
    const tempRoot = mkdtempSync(path.join(tmpdir(), "release-pr-files-"));
    const binDirectory = path.join(tempRoot, "bin");
    const callsPath = path.join(tempRoot, "gh-calls.txt");
    mkdirSync(binDirectory);
    const ghPath = path.join(binDirectory, "gh");
    writeFileSync(
      ghPath,
      `#!/bin/sh
printf '%s\\n' '---' "$@" >> "$GH_CALLS_FILE"
if [ "$#" -eq 4 ] && [ "$1" = "api" ] && [ "$2" = "--paginate" ] && [ "$3" = "--slurp" ] && [ "$4" = "$GH_EXPECTED_FILE_ENDPOINT" ]; then
  printf '%s' "$GH_FILE_PAGES"
elif [ "$#" -eq 2 ] && [ "$1" = "api" ] && [ "$2" = "$GH_EXPECTED_PR_ENDPOINT" ]; then
  printf '%s' "$GH_PULL_REQUEST"
else
  printf '%s\\n' 'unexpected gh arguments' >&2
  exit 1
fi
`,
    );
    chmodSync(ghPath, 0o755);

    const endpoint = "repos/BuilderIO/agent-native/pulls/8062/files";
    const pullRequestEndpoint = "repos/BuilderIO/agent-native/pulls/8062";
    const env = {
      ...process.env,
      PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
      REPO: "BuilderIO/agent-native",
      PR_NUMBER: "8062",
      GH_CALLS_FILE: callsPath,
      GH_EXPECTED_FILE_ENDPOINT: endpoint,
      GH_EXPECTED_PR_ENDPOINT: pullRequestEndpoint,
      GH_FILE_PAGES: pages,
      GH_PULL_REQUEST: JSON.stringify({ changed_files: files.length }),
    };

    const runCli = (script: string) =>
      execFileSync(
        process.execPath,
        ["--experimental-strip-types", path.resolve(script)],
        { cwd: process.cwd(), encoding: "utf8", env },
      );

    try {
      const packageOutput = runCli("scripts/list-release-pr-package-files.ts");
      assert.deepEqual(JSON.parse(packageOutput), [
        { filename: "packages/core/package.json", status: "modified" },
      ]);
      assert.deepEqual(readFileSync(callsPath, "utf8").trim().split("\n"), [
        "---",
        "api",
        "--paginate",
        "--slurp",
        endpoint,
      ]);

      writeFileSync(callsPath, "");
      assert.match(
        runCli("scripts/verify-release-package-files.ts"),
        /Verified 3 complete release PR file paths against the allowlist\./,
      );
      assert.deepEqual(readFileSync(callsPath, "utf8").trim().split("\n"), [
        "---",
        "api",
        "--paginate",
        "--slurp",
        endpoint,
        "---",
        "api",
        pullRequestEndpoint,
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }

    assert.throws(
      () => parseReleasePullRequestPackageFiles([[{}]]),
      /invalid release PR file list/,
    );
    assert.throws(
      () => parseReleasePullRequestPackageFiles({ files: [] }),
      /invalid release PR file list/,
    );
  });

  it("verifies versionless manifests through the release guard CLI", () => {
    const file = "templates/community/qr/package.json";
    const files = JSON.stringify([[{ filename: file, status: "modified" }]]);
    const tempRoot = mkdtempSync(path.join(tmpdir(), "release-version-guard-"));
    const binDirectory = path.join(tempRoot, "bin");
    const callsPath = path.join(tempRoot, "gh-calls.txt");
    mkdirSync(binDirectory);
    const ghPath = path.join(binDirectory, "gh");
    writeFileSync(
      ghPath,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$GH_CALLS_FILE"
if [ "$#" -eq 4 ] && [ "$1" = "api" ] && [ "$2" = "--paginate" ] && [ "$3" = "--slurp" ]; then
  printf '%s' "$GH_FILE_PAGES"
elif [ "$#" -eq 2 ] && [ "$1" = "api" ]; then
  case "$2" in
    *ref=base-sha)
      if [ "$GH_BASE_MANIFEST" = "__HTTP_404__" ]; then
        printf '%s\\n' 'gh: HTTP 404' >&2
        exit 1
      fi
      printf '%s' "$GH_BASE_MANIFEST"
      ;;
    *ref=head-sha) printf '%s' "$GH_HEAD_MANIFEST" ;;
    *) printf '%s\\n' 'unexpected gh endpoint' >&2; exit 1 ;;
  esac
else
  printf '%s\\n' 'unexpected gh arguments' >&2
  exit 1
fi
`,
    );
    chmodSync(ghPath, 0o755);

    const manifestResponse = (manifest: Record<string, unknown>) => {
      const content = Buffer.from(JSON.stringify(manifest));
      return JSON.stringify({
        encoding: "base64",
        content: content.toString("base64"),
        size: content.length,
      });
    };
    const env = {
      ...process.env,
      PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
      REPO: "BuilderIO/agent-native",
      PR_NUMBER: "8062",
      BASE_SHA: "base-sha",
      HEAD_SHA: "head-sha",
      GH_CALLS_FILE: callsPath,
      GH_FILE_PAGES: files,
      GH_BASE_MANIFEST: manifestResponse({ name: "qr" }),
      GH_HEAD_MANIFEST: manifestResponse({
        name: "qr",
        dependencies: { "@agent-native/core": "^0.217.0" },
      }),
    };

    const runCli = () =>
      execFileSync(
        process.execPath,
        [
          "--experimental-strip-types",
          path.resolve("scripts/verify-release-package-version-changes.ts"),
        ],
        { cwd: process.cwd(), encoding: "utf8", env },
      );

    try {
      assert.match(
        runCli(),
        /No forbidden promotion in 1 changed package.json file/,
      );
      assert.deepEqual(readFileSync(callsPath, "utf8").trim().split("\n"), [
        "api --paginate --slurp repos/BuilderIO/agent-native/pulls/8062/files",
        `api repos/BuilderIO/agent-native/contents/${file}?ref=base-sha`,
        `api repos/BuilderIO/agent-native/contents/${file}?ref=head-sha`,
      ]);

      writeFileSync(callsPath, "");
      env.GH_FILE_PAGES = JSON.stringify([
        [{ filename: "packages/core/package.json", status: "modified" }],
      ]);
      env.GH_BASE_MANIFEST = manifestResponse({
        name: "core",
        version: "0.216.0",
      });
      env.GH_HEAD_MANIFEST = manifestResponse({
        name: "core",
        version: "1.0.0",
      });
      assert.throws(runCli, (error: unknown) => {
        const commandError = error as { status?: number; stderr?: Buffer };
        assert.equal(commandError.status, 1);
        assert.match(
          String(commandError.stderr),
          /::error::This release PR contains a forbidden major promotion/,
        );
        return true;
      });

      env.GH_FILE_PAGES = files;
      env.GH_BASE_MANIFEST = "__HTTP_404__";
      env.GH_HEAD_MANIFEST = manifestResponse({ name: "qr" });
      assert.throws(runCli, (error: unknown) => {
        const commandError = error as { status?: number; stderr?: Buffer };
        assert.equal(commandError.status, 1);
        assert.match(
          String(commandError.stderr),
          /Could not verify package manifest versions/,
        );
        return true;
      });

      env.GH_BASE_MANIFEST = JSON.stringify({
        encoding: "base64",
        content: "%%%",
        size: 3,
      });
      assert.throws(runCli, (error: unknown) => {
        const commandError = error as { status?: number; stderr?: Buffer };
        assert.equal(commandError.status, 1);
        assert.match(
          String(commandError.stderr),
          /GitHub returned invalid base64 for/,
        );
        return true;
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("runs the community QR pin guard from the base commit before auto-merge", () => {
    const autoMergeTriggers = autoMergeWorkflow.on as Workflow;
    const workflowDispatch = autoMergeTriggers.workflow_dispatch as Workflow;
    const workflowDispatchInputs = workflowDispatch.inputs as Workflow;
    const autoMergeJobs = autoMergeWorkflow.jobs as Workflow;
    const autoMergeJob = autoMergeJobs["auto-merge"] as Workflow;
    const autoMergeSteps = autoMergeJob.steps as Workflow[];
    const checkout = autoMergeSteps.find(
      (step) =>
        step.uses ===
        "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5",
    );
    const releaseDiff = autoMergeSteps.find(
      (step) => step.name === "Verify release-only diff",
    );
    const qrPinGuard = autoMergeSteps.find(
      (step) => step.name === "Verify community QR template pins",
    );
    const releasePrContext = autoMergeSteps.find(
      (step) => step.name === "Verify release PR identity and event-bound SHAs",
    );
    const manualDispatcherGate = autoMergeSteps.find(
      (step) =>
        step.name === "Verify manual release dispatcher is an administrator",
    );
    const majorPromotionGuard = autoMergeSteps.find(
      (step) => step.name === "Refuse unattended major promotions",
    );
    const requiredChecks = autoMergeSteps.find(
      (step) => step.name === "Wait for required release PR checks",
    );
    const mergeToken = autoMergeSteps.find(
      (step) => step.name === "Generate fresh merge token",
    );
    const releasePrRecheck = autoMergeSteps.find(
      (step) => step.name === "Revalidate release PR before merge",
    );
    const forceMerge = autoMergeSteps.find(
      (step) => step.name === "Force-merge with admin bypass",
    );

    for (const input of ["pull_request_number", "base_sha", "head_sha"]) {
      assert.equal((workflowDispatchInputs[input] as Workflow).required, true);
    }
    assert.deepEqual(autoMergeWorkflow.permissions, {
      actions: "read",
      checks: "read",
      contents: "read",
      "pull-requests": "read",
      statuses: "read",
    });
    assert.match(
      String(autoMergeJob.if),
      /github\.event_name == 'workflow_dispatch'/,
    );
    assert.match(String(autoMergeJob.if), /github\.ref == 'refs\/heads\/main'/);

    assert.match(
      String(autoMergeJob.if),
      /github\.event\.pull_request\.head\.ref == 'changeset-release\/main'/,
    );
    assert.match(
      String(autoMergeJob.if),
      /github\.event\.pull_request\.user\.login == 'builder-io-integration\[bot\]'/,
    );
    assert.match(
      String(autoMergeJob.if),
      /github\.event\.sender\.login == 'builder-io-integration\[bot\]'/,
    );
    assert.match(
      String(autoMergeJob.if),
      /!github\.event\.pull_request\.draft/,
    );

    assert(checkout);
    assert.equal(
      (checkout.with as Workflow).ref,
      "${{ github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.sha || github.event.pull_request.base.sha }}",
    );
    assert(manualDispatcherGate);
    assert.match(
      String(manualDispatcherGate.if),
      /github\.event_name == 'workflow_dispatch'/,
    );
    assert.match(
      String((manualDispatcherGate.env as Workflow).DISPATCH_ACTOR),
      /github\.triggering_actor/,
    );
    assert.match(
      String(manualDispatcherGate.run),
      /collaborators\/\$DISPATCH_ACTOR\/permission/,
    );
    assert.match(
      String(manualDispatcherGate.run),
      /dispatch_permission" != "admin"/,
    );
    assert(releasePrContext);
    assert.match(String(releasePrContext.run), /\.user\.login/);
    assert.match(
      String(releasePrContext.run),
      /\.head\.repo\.full_name == \$repo/,
    );
    assert.match(String(releasePrContext.run), /\.head\.sha == \$head/);
    assert.match(String(releasePrContext.run), /\.base\.sha == \$base/);
    assert(requiredChecks);
    assert.equal(requiredChecks.id, "required-checks");
    assert.match(
      String(requiredChecks.run),
      /release-required-checks\.ts wait "\$PR_NUMBER" "\$REPO"/,
    );
    assert.equal(
      (requiredChecks.env as Workflow).GH_TOKEN,
      "${{ github.token }}",
    );
    assert.equal(
      (requiredChecks.env as Workflow).GH_ACTIONS_TOKEN,
      "${{ github.token }}",
    );
    assert.equal(
      (requiredChecks.env as Workflow).RELEASE_EVENT_NAME,
      "${{ github.event_name }}",
    );
    assert.match(
      String((requiredChecks.env as Workflow).PR_UPDATED_AT),
      /pull_request\.updated_at/,
    );
    assert.match(
      String(requiredChecks.run),
      /coordinator_run_id=.*GITHUB_OUTPUT/,
    );
    assert.doesNotMatch(String(requiredChecks.run), /gh pr checks/);
    assert(mergeToken);
    assert(releaseDiff);
    assert.match(String(mergeToken.uses), /actions\/create-github-app-token/);
    assert(
      autoMergeSteps.indexOf(requiredChecks) <
        autoMergeSteps.indexOf(mergeToken),
    );
    assert(
      autoMergeSteps.indexOf(mergeToken) < autoMergeSteps.indexOf(releaseDiff),
    );
    for (const step of autoMergeSteps.slice(
      autoMergeSteps.indexOf(mergeToken) + 1,
    )) {
      const env = step.env as Workflow | undefined;
      if (env && "GH_TOKEN" in env) {
        assert.equal(env.GH_TOKEN, "${{ steps.merge-token.outputs.token }}");
      }
    }
    assert.equal(
      (releaseDiff.env as Workflow).GH_TOKEN,
      "${{ steps.merge-token.outputs.token }}",
    );
    assert.match(String(releaseDiff.run), /verify-release-package-files\.ts/);
    assert(majorPromotionGuard);
    assert.equal(
      majorPromotionGuard.run,
      "node --experimental-strip-types scripts/verify-release-package-version-changes.ts",
    );
    assert(
      autoMergeSteps.indexOf(releaseDiff) <
        autoMergeSteps.indexOf(majorPromotionGuard),
    );
    assert.match(
      String((majorPromotionGuard.env as Workflow).BASE_SHA),
      /inputs\.base_sha/,
    );
    assert.match(
      String((majorPromotionGuard.env as Workflow).HEAD_SHA),
      /inputs\.head_sha/,
    );
    assert.match(
      String((majorPromotionGuard.env as Workflow).PR_NUMBER),
      /inputs\.pull_request_number/,
    );
    assert(qrPinGuard);
    assert.equal(
      qrPinGuard.run,
      "node --experimental-strip-types scripts/verify-community-qr-release-pin.ts",
    );
    assert(releasePrRecheck);
    assert.equal(
      (releasePrRecheck.env as Workflow).GH_TOKEN,
      "${{ steps.merge-token.outputs.token }}",
    );
    assert.match(String(releasePrRecheck.run), /\.state == "open"/);
    assert.match(String(releasePrRecheck.run), /\.user\.login/);
    assert.match(
      String(releasePrRecheck.run),
      /\.head\.repo\.full_name == \$repo/,
    );
    assert.match(String(releasePrRecheck.run), /\.head\.sha == \$head/);
    assert.match(String(releasePrRecheck.run), /\.base\.sha == \$base/);
    assert.match(
      String(releasePrRecheck.run),
      /release-required-checks\.ts verify "\$PR_NUMBER" "\$REPO"/,
    );
    assert.match(
      String((releasePrRecheck.env as Workflow).EXPECTED_COORDINATOR_RUN_ID),
      /required-checks\.outputs\.coordinator_run_id/,
    );
    assert(forceMerge);
    assert.equal(
      (forceMerge.env as Workflow).GH_TOKEN,
      "${{ steps.merge-token.outputs.token }}",
    );
    assert.match(String(forceMerge.run), /branches\/main/);
    assert.match(String(forceMerge.run), /current_main.*BASE_SHA/s);
    assert.match(String(forceMerge.run), /--match-head-commit "\$HEAD_SHA"/);
    assert.match(
      String(forceMerge.run),
      /release-required-checks\.ts verify "\$PR_NUMBER" "\$REPO"/,
    );
    assert.match(
      String((forceMerge.env as Workflow).EXPECTED_COORDINATOR_RUN_ID),
      /required-checks\.outputs\.coordinator_run_id/,
    );
    assert(
      String(forceMerge.run).indexOf("release-required-checks.ts verify") <
        String(forceMerge.run).indexOf("gh pr merge"),
    );
  });

  it("waits until local runtime packages are fetchable before publishing dependents", async () => {
    const core = {
      dir: "packages/core",
      name: "@agent-native/core",
      version: "0.213.0",
      packageJson: { name: "@agent-native/core", version: "0.213.0" },
    };
    const dispatchPackage = {
      dir: "packages/dispatch",
      name: "@agent-native/dispatch",
      version: "0.40.32",
      packageJson: {
        name: "@agent-native/dispatch",
        version: "0.40.32",
        dependencies: { "@agent-native/core": "^0.213.0" },
        devDependencies: { "@agent-native/toolkit": "^0.0.0" },
        peerDependencies: { "@agent-native/pinpoint": "^0.0.0" },
      },
    };
    const fetchable = new Set<string>();
    const failed = new Set<string>();
    const checks: string[] = [];

    await ensureLocalRuntimeDependenciesAvailable(
      dispatchPackage,
      [core, dispatchPackage],
      async (dependency) => {
        checks.push(dependency.name);
      },
      fetchable,
      failed,
    );

    assert.deepEqual(checks, ["@agent-native/core"]);
    assert.deepEqual([...fetchable], ["@agent-native/core"]);

    await ensureLocalRuntimeDependenciesAvailable(
      dispatchPackage,
      [core, dispatchPackage],
      async (dependency) => {
        checks.push(dependency.name);
      },
      fetchable,
      failed,
    );
    assert.deepEqual(checks, ["@agent-native/core"]);
  });

  it("marks an unavailable dependency failed and skips later dependents", async () => {
    const core = {
      dir: "packages/core",
      name: "@agent-native/core",
      version: "0.213.0",
      packageJson: { name: "@agent-native/core", version: "0.213.0" },
    };
    const dispatchPackage = {
      dir: "packages/dispatch",
      name: "@agent-native/dispatch",
      version: "0.40.32",
      packageJson: {
        name: "@agent-native/dispatch",
        version: "0.40.32",
        dependencies: { "@agent-native/core": "^0.213.0" },
      },
    };
    const toolkitPackage = {
      dir: "packages/toolkit",
      name: "@agent-native/toolkit",
      version: "0.14.0",
      packageJson: {
        name: "@agent-native/toolkit",
        version: "0.14.0",
        dependencies: { "@agent-native/core": "^0.213.0" },
      },
    };
    const fetchable = new Set<string>();
    const failed = new Set<string>();
    const checks: string[] = [];

    await assert.rejects(
      ensureLocalRuntimeDependenciesAvailable(
        dispatchPackage,
        [core, dispatchPackage, toolkitPackage],
        async (dependency) => {
          checks.push(dependency.name);
          throw new Error(`${dependency.name} is not fetchable`);
        },
        fetchable,
        failed,
      ),
      /@agent-native\/core is not fetchable/,
    );
    assert.deepEqual([...failed], ["@agent-native/core"]);

    await assert.rejects(
      ensureLocalRuntimeDependenciesAvailable(
        toolkitPackage,
        [core, dispatchPackage, toolkitPackage],
        async (dependency) => {
          checks.push(dependency.name);
        },
        fetchable,
        failed,
      ),
      /@agent-native\/toolkit depends on failed local runtime package: @agent-native\/core/,
    );
    assert.deepEqual(checks, ["@agent-native/core"]);
  });

  it("does not retry failed availability checks before tagging independent packages", async () => {
    const core = {
      dir: "packages/core",
      name: "@agent-native/core",
      version: "0.213.0",
      packageJson: { name: "@agent-native/core", version: "0.213.0" },
    };
    const dispatchPackage = {
      dir: "packages/dispatch",
      name: "@agent-native/dispatch",
      version: "0.40.32",
      packageJson: { name: "@agent-native/dispatch", version: "0.40.32" },
    };
    const unrelatedPackage = {
      dir: "packages/otel",
      name: "@agent-native/otel",
      version: "0.1.14",
      packageJson: { name: "@agent-native/otel", version: "0.1.14" },
    };
    const fetchable = new Set<string>();
    const failed = new Set(["@agent-native/core"]);
    const checks: string[] = [];

    const result = await preparePackagesForTagging(
      [core, dispatchPackage, unrelatedPackage],
      async (pkg) => {
        checks.push(pkg.name);
        if (pkg.name === "@agent-native/dispatch") {
          throw new Error("dispatch is not fetchable");
        }
      },
      fetchable,
      failed,
    );

    assert.deepEqual(checks, ["@agent-native/dispatch", "@agent-native/otel"]);
    assert.deepEqual(result.packages, [unrelatedPackage]);
    assert.deepEqual(
      result.failures.map(({ pkg, error }) => [
        pkg.name,
        (error as Error).message,
      ]),
      [["@agent-native/dispatch", "dispatch is not fetchable"]],
    );
    assert.deepEqual(
      [...failed],
      ["@agent-native/core", "@agent-native/dispatch"],
    );
    assert.deepEqual([...fetchable], ["@agent-native/otel"]);
  });

  describe("dev snapshot publishing", () => {
    const devSnapshot = jobs["publish-dev-snapshot"] as Workflow;

    it("exposes an optional devTag dispatch input, empty by default", () => {
      assert.deepEqual(inputs.devTag, {
        description:
          "Dev snapshot: publish a testable version from this branch under npm dist-tag dev-<value> (leave empty for a normal stable dispatch)",
        required: false,
        type: "string",
        default: "",
      });
    });

    it("only runs on a manual dispatch with a non-empty devTag", () => {
      assert(devSnapshot);
      assert.match(
        String(devSnapshot.if),
        /github\.event_name == 'workflow_dispatch'/,
      );
      assert.match(String(devSnapshot.if), /inputs\.devTag != ''/);
      assert.doesNotMatch(String(devSnapshot.if), /needs\.verify-stable-merge/);
      assert.equal(devSnapshot.needs, undefined);
    });

    it("is not gated to main and does not depend on verify-stable-merge", () => {
      assert.equal(workflow.on, trigger);
      assert.doesNotMatch(JSON.stringify(devSnapshot), /branches/);
    });

    it("validates the tag and synthesizes a changeset before versioning", () => {
      const steps = devSnapshot.steps as Workflow[];
      const prepare = steps.find(
        (step) => step.name === "Validate dev tag and prepare a changeset",
      );
      assert(prepare);
      assert.match(String(prepare.run), /prepare-dev-snapshot\.ts/);

      const version = steps.find(
        (step) => step.name === "Create dev snapshot versions",
      );
      assert(version);
      assert.match(
        String(version.run),
        /changeset version --snapshot "\$DEV_TAG"/,
      );

      const prepareIndex = steps.indexOf(prepare);
      const versionIndex = steps.indexOf(version);
      assert(prepareIndex < versionIndex);
    });

    it("publishes under a dev-prefixed dist-tag via the sequential publisher", () => {
      const steps = devSnapshot.steps as Workflow[];
      const publish = steps.find(
        (step) => step.name === "Publish dev snapshot packages sequentially",
      );
      assert(publish);
      assert.equal(publish.id, "publish");
      assert.equal(
        (publish.env as Workflow).AGENT_NATIVE_NPM_DIST_TAG,
        "dev-${{ inputs.devTag }}",
      );
      assert.equal(publish.run, "node scripts/changeset-publish-sequential.ts");
      assert.doesNotMatch(
        String((publish.env as Workflow).AGENT_NATIVE_NPM_DIST_TAG),
        /^(latest|nightly)$/,
      );
    });

    it("reuses the npm-publish environment for OIDC trusted publishing", () => {
      assert.equal(devSnapshot.environment, "npm-publish");
      assert.deepEqual(devSnapshot.permissions, {
        contents: "read",
        "id-token": "write",
      });
    });

    it("summarizes using the publish step's actual output, not a directory scan", () => {
      const steps = devSnapshot.steps as Workflow[];
      const summary = steps.find(
        (step) => step.name === "Summarize dev snapshot publish",
      );
      assert(summary);
      assert.equal(
        (summary.env as Workflow).PUBLISHED_PACKAGES,
        "${{ steps.publish.outputs.published-packages }}",
      );
      assert.doesNotMatch(
        String(summary.run),
        /readdir|ls packages|find packages/,
      );
    });

    it("has its own concurrency lane keyed by branch and tag", () => {
      const group = String((workflow.concurrency as Workflow).group);
      assert.match(group, /inputs\.devTag/);
      assert.match(group, /format\('dev-\{0\}', inputs\.devTag\)/);
      assert.match(group, /stable-preparation/);
      assert.match(group, /stable-publication/);
    });

    it("gates the stable release job off when devTag is set", () => {
      const release = jobs.release as Workflow;
      assert.match(String(release.if), /!inputs\.devTag/);
    });

    it("excludes dev snapshot dispatches from downstream notification", () => {
      const notify = jobs["notify-downstream"] as Workflow;
      assert.match(String(notify.if), /!inputs\.devTag/);
    });
  });
});
