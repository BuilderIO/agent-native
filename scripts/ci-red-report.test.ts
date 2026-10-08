import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCiRedRows,
  parseFailedTestNames,
  renderCiRedReport,
  runCiRedReportCli,
  type WorkflowJob,
  type WorkflowRun,
  type WorkflowStep,
} from "./ci-red-report.ts";

const now = new Date("2026-10-06T00:00:00.000Z");
const since = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

function run(id: number, overrides: Record<string, unknown> = {}): WorkflowRun {
  return {
    id,
    name: "Design E2E",
    path: ".github/workflows/design-e2e.yml@main",
    html_url: `https://github.com/BuilderIO/agent-native/actions/runs/${id}`,
    event: "push",
    head_branch: "main",
    created_at: "2026-10-05T12:00:00Z",
    updated_at: "2026-10-05T12:30:00Z",
    status: "completed",
    conclusion: "failure",
    run_attempt: 1,
    ...overrides,
  } as WorkflowRun;
}

function step(name: string, conclusion: string | null): WorkflowStep {
  return { name, status: "completed", conclusion };
}

function job(
  runId: number,
  id: number,
  overrides: Record<string, unknown> = {},
): WorkflowJob {
  return {
    id,
    run_id: runId,
    name: "chromium / design editor",
    status: "completed",
    conclusion: "failure",
    started_at: "2026-10-05T12:00:00Z",
    completed_at: "2026-10-05T12:30:00Z",
    runner_name: "GitHub Actions",
    steps: [step("Run Design E2E", "failure")],
    ...overrides,
  } as WorkflowJob;
}

const fixtureRuns: Record<"push" | "schedule", WorkflowRun[]> = {
  push: [
    run(10),
    run(12, { head_branch: "feature/design" }),
    run(13, { conclusion: "success" }),
    run(14, { created_at: "2026-10-01T00:00:00.000Z" }),
    run(15, { created_at: "2026-09-30T23:59:59.999Z" }),
    run(19, { created_at: "2026-08-27T00:00:00.000Z" }),
    run(20, { created_at: "2026-10-06T00:00:00.001Z" }),
  ],
  schedule: [
    run(11, { event: "schedule", conclusion: "cancelled" }),
    run(16, { event: "schedule" }),
  ],
};

const fixtureJobs: Record<number, WorkflowJob[]> = {
  10: [
    job(10, 101, {
      steps: [
        step("Set up job", "success"),
        step("Run shard", "failure"),
        step("Post cleanup", "cancelled"),
      ],
    }),
    job(10, 102, { name: "firefox / design editor", conclusion: "cancelled" }),
  ],
  14: [
    job(14, 141, {
      conclusion: "success",
      completed_at: "2026-09-30T23:59:59Z",
      steps: [step("All steps", "success")],
    }),
  ],
  15: [job(15, 151, { completed_at: "2026-10-02T00:00:00Z" })],
  16: [
    job(16, 161, {
      conclusion: "success",
      completed_at: "2026-10-05T12:00:00Z",
      steps: [step("All steps", "success")],
    }),
  ],
  19: [job(19, 191, { completed_at: "2026-10-01T00:00:00Z" })],
};

const paged = (itemsKey: "workflow_runs" | "jobs", items: unknown[]) =>
  JSON.stringify([{ total_count: items.length, [itemsKey]: items }]);

function fixtureApi(endpoints: string[]): (endpoint: string) => string {
  return (endpoint) => {
    endpoints.push(endpoint);
    const runList = endpoint.match(/event=(push|schedule)/);
    if (runList) {
      const event = runList[1] as keyof typeof fixtureRuns;
      const range = endpoint.match(/created=([^&]+)&per_page=/)?.[1];
      const [start, end] = range?.split("..") ?? [];
      if (!start || !end)
        throw new Error(`missing created-time window in ${endpoint}`);
      const startMs = Date.parse(start);
      const endMs = Date.parse(end);
      const inclusiveEndMs = /^\d{4}-\d{2}-\d{2}$/.test(end)
        ? endMs + 24 * 60 * 60 * 1000 - 1
        : endMs;
      return paged(
        "workflow_runs",
        fixtureRuns[event].filter((workflowRun) => {
          const created = Date.parse(workflowRun.created_at);
          return created >= startMs && created <= inclusiveEndMs;
        }),
      );
    }
    const jobsMatch = endpoint.match(/actions\/runs\/(\d+)\/jobs/);
    if (jobsMatch) {
      const runId = Number(jobsMatch[1]);
      return paged("jobs", fixtureJobs[runId] ?? []);
    }
    throw new Error(`unexpected endpoint ${endpoint}`);
  };
}

describe("ci-red-report", () => {
  it("filters by conclusion time and fingerprints failed job steps", async () => {
    const endpoints: string[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCiRedReportCli({
      api: fixtureApi(endpoints),
      failedRunLog: (runId) =>
        runId === 10
          ? [
              "chromium / design editor\tRender canvas spec\t2026-10-05T12:20:00Z ##[error] 1) [chromium] › e2e/canvas-invariants.spec.ts:42:1 › group fill persists",
              "chromium / design editor\tRun inspector spec\t2026-10-05T12:20:00Z ##[error] 2) [chromium] › e2e/inspector-styles.spec.ts:88:1 › empty stroke title opens color picker",
              "chromium / design editor\tRun shard\t2026-10-05T12:20:00Z ##[notice] 2 failed, 0 flaky",
            ].join("\n")
          : "captured log without test annotations",
      now,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(stderr, []);
    assert.equal(stdout.length, 1);
    const lines = stdout[0].trimEnd().split("\n");
    assert.equal(
      lines[0],
      "workflow\tworkflow_path\tjob\tstep\ttest\tfingerprint_grain\tfingerprint\trun_count\toccurrence_count\truns_json",
    );
    const columns = Object.fromEntries(
      lines[0].split("\t").map((name, index) => [name, index]),
    );
    const reportRows = lines.slice(1).map((line) => line.split("\t"));
    assert.equal(reportRows.length, 4);
    const testRow = reportRows.find((row) =>
      /canvas-invariants\.spec\.ts.*group fill persists/.test(
        row[columns.test],
      ),
    );
    assert.ok(testRow);
    assert.equal(testRow[columns.fingerprint_grain], "test");
    assert.equal(testRow[columns.step], "Render canvas spec");
    const inspectorTestRow = reportRows.find((row) =>
      /inspector-styles\.spec\.ts.*empty stroke title opens color picker/.test(
        row[columns.test],
      ),
    );
    assert.ok(inspectorTestRow);
    assert.equal(inspectorTestRow[columns.step], "Run inspector spec");
    for (const row of reportRows) {
      assert.match(row[columns.fingerprint], /^sha256:[a-f0-9]{64}$/);
    }
    const repeatedStep = reportRows.find(
      (row) =>
        row[columns.job].startsWith("chromium / design editor") &&
        row[columns.step] === "Run Design E2E",
    );
    assert.ok(repeatedStep);
    assert.equal(repeatedStep[columns.run_count], "2");
    assert.deepEqual(
      JSON.parse(repeatedStep[columns.runs_json]).map(
        ({ runId }: { runId: number }) => runId,
      ),
      [15, 19],
    );
    const workflowFailure = reportRows.find(
      (row) => row[columns.fingerprint_grain] === "workflow",
    );
    assert.ok(workflowFailure);
    assert.equal(endpoints.length, 7);
    assert.match(
      endpoints[0],
      /branch=main&event=push&created=2026-08-27\.\.2026-10-06T00:00:00\.000Z&per_page=100/,
    );
    assert.match(
      endpoints[1],
      /branch=main&event=schedule&created=2026-08-27\.\.2026-10-06T00:00:00\.000Z&per_page=100/,
    );
    assert.ok(!endpoints[0].includes("status="));
    assert.ok(
      endpoints
        .slice(2)
        .every((endpoint) => endpoint.includes("filter=latest&per_page=100")),
    );
    assert.ok(!endpoints.some((endpoint) => endpoint.includes("runs/20/jobs")));
    assert.ok(
      JSON.parse(repeatedStep[columns.runs_json]).some(
        ({ runId, concludedAt }: { runId: number; concludedAt: string }) =>
          runId === 15 && concludedAt === "2026-10-02T00:00:00.000Z",
      ),
    );
  });

  it("groups by fingerprint and orders Design E2E and product workflows first", () => {
    const runs = [
      run(30),
      run(31),
      run(32, { name: "CI", path: ".github/workflows/ci.yml@main" }),
      run(33, {
        name: "Beta deploy",
        path: ".github/workflows/deploy-beta-sites.yml@main",
      }),
      run(34, {
        name: "Hosted app health audit",
        path: ".github/workflows/keep-neon-warm.yml@main",
      }),
    ];
    const rows = buildCiRedRows(
      runs,
      new Map(
        runs.map((workflowRun) => [
          workflowRun.id,
          [
            job(workflowRun.id, workflowRun.id * 10, {
              steps: [
                step(
                  workflowRun.id === 33 ? "Publish artifacts" : "Run checks",
                  "failure",
                ),
              ],
            }),
          ],
        ]),
      ),
      since,
      now,
    );
    const lines = renderCiRedReport([...rows, rows[0]!])
      .trimEnd()
      .split("\n");
    const headers = lines[0].split("\t");
    const records = lines.slice(1).map((line) => {
      const cells = line.split("\t");
      return Object.fromEntries(headers.map((header, i) => [header, cells[i]]));
    });

    assert.equal(records.length, 4);
    assert.deepEqual(
      records.map((record) => record.workflow),
      ["Design E2E", "Beta deploy", "Hosted app health audit", "CI"],
    );
    assert.equal(records[0].run_count, "2");
    assert.deepEqual(
      JSON.parse(records[0].runs_json).map(
        ({ runId }: { runId: number }) => runId,
      ),
      [31, 30],
    );
  });

  it("retains every matrix job occurrence for one test fingerprint", () => {
    const workflowRun = run(35);
    const test =
      "chromium :: e2e/canvas-invariants.spec.ts:42:1 › fill persists";
    const jobs = [
      job(35, 351, {
        name: "chromium / Node 22",
        steps: [step("Run browser tests", "failure")],
      }),
      job(35, 352, {
        name: "chromium / Node 24",
        steps: [step("Run browser tests", "failure")],
      }),
    ];
    const rows = buildCiRedRows(
      [workflowRun],
      new Map([[workflowRun.id, jobs]]),
      since,
      now,
      new Map([
        [workflowRun.id, new Map(jobs.map(({ name }) => [name, [test]]))],
      ]),
    );
    const [header, ...lines] = renderCiRedReport(rows).trimEnd().split("\n");
    const columns = Object.fromEntries(
      header.split("\t").map((name, index) => [name, index]),
    );
    assert.equal(lines.length, 1);
    const fields = lines[0].split("\t");
    assert.equal(fields[columns.run_count], "1");
    assert.equal(fields[columns.occurrence_count], "2");
    assert.deepEqual(JSON.parse(fields[columns.runs_json])[0].jobSteps, [
      { job: "chromium / Node 22", step: "Run browser tests", test },
      { job: "chromium / Node 24", step: "Run browser tests", test },
    ]);
  });

  it("uses stable run/job/step rows for pure fixture input", () => {
    const runs = [
      run(2),
      run(1, { path: ".github/workflows/ci.yml@main", name: "CI" }),
      run(3, { conclusion: "cancelled" }),
    ];
    const jobs = new Map([
      [
        2,
        [
          job(2, 21, {
            steps: [step("Z test", "failure"), step("A test", "failure")],
          }),
        ],
      ],
      [1, [job(1, 11)]],
    ]);
    const rows = buildCiRedRows(runs, jobs, since, now);
    assert.deepEqual(
      rows.map(({ runId, workflowPath, step: stepName }) => [
        runId,
        workflowPath,
        stepName,
      ]),
      [
        [1, ".github/workflows/ci.yml@main", "Run Design E2E"],
        [2, ".github/workflows/design-e2e.yml@main", "A test"],
        [2, ".github/workflows/design-e2e.yml@main", "Z test"],
      ],
    );
    assert.equal(
      rows[1].fingerprint,
      buildCiRedRows(runs, jobs, since, now)[1].fingerprint,
    );
    assert.notEqual(rows[1].fingerprint, rows[2].fingerprint);
  });

  it("uses test fingerprints only when annotations match the final non-flaky summary", () => {
    const log = [
      "Shard 5/8\tUNKNOWN STEP\t2026-10-06T09:56:34Z ##[error] 1) [chromium] › e2e/parity-drag-move.spec.ts:294:1 › in-screen: Escape after a completed drag does NOT revert it",
      "Shard 5/8\tUNKNOWN STEP\t2026-10-06T09:56:34Z ##[error] 2) [chromium] › e2e/parity-drag-move.spec.ts:582:1 › in-screen: arrow-nudge after a drag continues from the dropped position",
      "Shard 5/8\tUNKNOWN STEP\t2026-10-06T09:56:34Z ##[notice] 2 failed, 0 flaky",
    ].join("\n");
    const testFailures = parseFailedTestNames(log);
    assert.deepEqual(testFailures.get("Shard 5/8"), [
      "chromium :: e2e/parity-drag-move.spec.ts:294:1 › in-screen: Escape after a completed drag does NOT revert it",
      "chromium :: e2e/parity-drag-move.spec.ts:582:1 › in-screen: arrow-nudge after a drag continues from the dropped position",
    ]);

    const rows = buildCiRedRows(
      [run(10)],
      new Map([[10, [job(10, 101, { name: "Shard 5/8" })]]]),
      since,
      now,
      new Map([[10, testFailures]]),
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].fingerprintGrain, "test");
    assert.equal(rows[0].test, testFailures.get("Shard 5/8")?.[0]);
    assert.notEqual(rows[0].fingerprint, rows[1].fingerprint);
    const movedLine = buildCiRedRows(
      [run(10)],
      new Map([[10, [job(10, 101, { name: "Shard 5/8" })]]]),
      since,
      now,
      new Map([
        [
          10,
          new Map([
            [
              "Shard 5/8",
              [
                "chromium :: e2e/parity-drag-move.spec.ts:999:4 › in-screen: Escape after a completed drag does NOT revert it",
              ],
            ],
          ]),
        ],
      ]),
    );
    assert.equal(rows[0].fingerprint, movedLine[0].fingerprint);

    const sameTestAcrossShards = buildCiRedRows(
      [run(12), run(13)],
      new Map([
        [12, [job(12, 121, { name: "Shard 5/8" })]],
        [13, [job(13, 131, { name: "Shard 6/8" })]],
      ]),
      since,
      now,
      new Map([
        [
          12,
          new Map([
            [
              "Shard 5/8",
              [
                "chromium :: e2e/canvas-invariants.spec.ts:42:1 › fill persists",
              ],
            ],
          ]),
        ],
        [
          13,
          new Map([
            [
              "Shard 6/8",
              [
                "chromium :: e2e/canvas-invariants.spec.ts:42:1 › fill persists",
              ],
            ],
          ]),
        ],
      ]),
    );
    assert.equal(sameTestAcrossShards.length, 2);
    assert.equal(
      sameTestAcrossShards[0].fingerprint,
      sameTestAcrossShards[1].fingerprint,
    );

    const flakyLog = [
      "Shard 5/8\tUNKNOWN STEP\t2026-10-06T09:56:34Z ##[error] 1) [chromium] › e2e/retry.spec.ts:11:1 › passed on retry",
      "Shard 5/8\tUNKNOWN STEP\t2026-10-06T09:56:34Z ##[notice] 1 failed, 1 flaky",
    ].join("\n");
    assert.deepEqual(parseFailedTestNames(flakyLog), new Map());
    assert.deepEqual(
      parseFailedTestNames(
        "Shard 9/9\tUNKNOWN STEP\t2026-10-06T10:30:00Z ##[error] 1) [chromium] › e2e/timeout.spec.ts:11:1 › run ended before final summary",
      ),
      new Map(),
    );

    const workflowFailure = buildCiRedRows(
      [run(11)],
      new Map([[11, []]]),
      since,
      now,
    );
    assert.equal(workflowFailure[0].fingerprintGrain, "workflow");
  });

  it("includes actionable conclusions but ignores cancelled runs", async () => {
    const timedOut = run(42, { conclusion: "timed_out" });
    const startupFailed = run(44, { conclusion: "startup_failure" });
    const actionRequired = run(45, { conclusion: "action_required" });
    const cancelled = run(43, { event: "schedule", conclusion: "cancelled" });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCiRedReportCli({
      api: (endpoint) => {
        if (endpoint.includes("event=push")) {
          return paged("workflow_runs", [
            timedOut,
            startupFailed,
            actionRequired,
          ]);
        }
        if (endpoint.includes("event=schedule")) {
          return paged("workflow_runs", [cancelled]);
        }
        return paged("jobs", []);
      },
      failedRunLog: () => "completed log without test annotations",
      now,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(stderr, []);
    assert.match(stdout.join(""), /Design E2E/);
    assert.match(stdout.join(""), /workflow\t/);
    assert.doesNotMatch(
      stdout.join(""),
      /no push-to-main or scheduled failures/,
    );
    const [header, ...rows] = stdout.join("").trimEnd().split("\n");
    assert.equal(rows.length, 1);
    assert.match(rows[0], /\tworkflow\t/);
    const columns = Object.fromEntries(
      header.split("\t").map((name, index) => [name, index]),
    );
    const row = rows[0].split("\t");
    assert.equal(row[columns.run_count], "3");
    assert.deepEqual(
      JSON.parse(row[columns.runs_json]).map(
        ({ runId }: { runId: number }) => runId,
      ),
      [45, 44, 42],
    );
  });

  it("ignores failed workflows cancelled before actionable jobs ran", () => {
    const cancelled = run(46);
    const skippedOnly = run(47);
    const jobs = new Map([
      [
        cancelled.id,
        [
          job(cancelled.id, 461, {
            conclusion: "cancelled",
            started_at: "2026-10-05T12:01:00Z",
            runner_name: "",
            steps: [],
          }),
          job(cancelled.id, 462, {
            conclusion: "skipped",
            steps: [step("Run Design E2E", "skipped")],
          }),
        ],
      ],
      [
        skippedOnly.id,
        [
          job(skippedOnly.id, 471, {
            conclusion: "skipped",
            steps: [step("Run Design E2E", "skipped")],
          }),
        ],
      ],
    ]);

    const rows = buildCiRedRows([cancelled, skippedOnly], jobs, since, now);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].runId, skippedOnly.id);
    assert.equal(rows[0].fingerprintGrain, "workflow");
  });

  it("keeps a workflow-level failure when a cancelled job has started", () => {
    const cancelledAfterStart = run(48);
    const rows = buildCiRedRows(
      [cancelledAfterStart],
      new Map([
        [
          cancelledAfterStart.id,
          [
            job(cancelledAfterStart.id, 481, {
              conclusion: "cancelled",
              started_at: "2026-10-05T12:05:00Z",
              steps: [step("Run Design E2E", "cancelled")],
            }),
          ],
        ],
      ]),
      since,
      now,
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].runId, cancelledAfterStart.id);
    assert.equal(rows[0].fingerprintGrain, "workflow");
  });

  it("warns and keeps job-step fingerprints when case annotations lack a final summary", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCiRedReportCli({
      api: (endpoint) => {
        if (endpoint.includes("event=push")) {
          return paged("workflow_runs", [run(50)]);
        }
        if (endpoint.includes("event=schedule")) {
          return paged("workflow_runs", []);
        }
        return paged("jobs", [
          job(50, 501, {
            name: "chromium / design editor",
            steps: [step("Run shard", "failure")],
          }),
        ]);
      },
      failedRunLog: () =>
        "chromium / design editor\tRun browser tests\t2026-10-05T12:20:00Z ##[error] 1) [chromium] › e2e/timeout.spec.ts:11:1 › run ended before final summary",
      now,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    assert.equal(exitCode, 0);
    assert.match(
      stderr.join(""),
      /case annotations for job chromium \/ design editor/,
    );
    assert.match(stderr.join(""), /no matching final complete summary/);
    assert.match(stderr.join(""), /keeping job-step fingerprints/);
    const [header, ...rows] = stdout[0].trimEnd().split("\n");
    const columns = Object.fromEntries(
      header.split("\t").map((name, index) => [name, index]),
    );
    assert.equal(rows.length, 1);
    const row = rows[0].split("\t");
    assert.equal(row[columns.fingerprint_grain], "job-step");
    assert.equal(row[columns.step], "Run shard");
    assert.equal(row[columns.test], "");
  });

  it("inspects generic workflow logs with bounded concurrency", async () => {
    const genericRuns = Array.from({ length: 6 }, (_, index) =>
      run(100 + index, {
        name: "CI",
        path: ".github/workflows/ci.yml@main",
      }),
    );
    const logRunIds: number[] = [];
    let activeLogs = 0;
    let maxActiveLogs = 0;
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCiRedReportCli({
      api: (endpoint) => {
        if (endpoint.includes("event=push")) {
          return paged("workflow_runs", genericRuns);
        }
        if (endpoint.includes("event=schedule")) {
          return paged("workflow_runs", []);
        }
        const match = endpoint.match(/actions\/runs\/(\d+)\/jobs/);
        if (!match) throw new Error(`unexpected endpoint ${endpoint}`);
        const runId = Number(match[1]);
        return paged("jobs", [
          job(runId, runId * 10, {
            name: "build",
            run_id: runId,
            steps: [step("execute", "failure")],
          }),
        ]);
      },
      failedRunLog: async (runId) => {
        logRunIds.push(runId);
        activeLogs += 1;
        maxActiveLogs = Math.max(maxActiveLogs, activeLogs);
        try {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return [
            `build\tRun command\t2026-10-05T12:20:00Z ##[error] 1) [chromium] › e2e/ci-${runId}.spec.ts:1:1 › generic workflow failure`,
            "build\tRun command\t2026-10-05T12:20:00Z ##[notice] 1 failed, 0 flaky",
          ].join("\n");
        } finally {
          activeLogs -= 1;
        }
      },
      now,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(stderr, []);
    assert.deepEqual(
      logRunIds.sort((left, right) => left - right),
      [100, 101, 102, 103, 104, 105],
    );
    assert.equal(maxActiveLogs, 4);
    assert.match(stdout.join(""), /generic workflow failure/);
    assert.match(stdout.join(""), /\ttest\t/);
  });

  it("warns when failed-run logs are unavailable and keeps job-step rows", async () => {
    const endpoints: string[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCiRedReportCli({
      api: fixtureApi(endpoints),
      failedRunLog: () => null,
      now,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    assert.equal(exitCode, 0);
    assert.match(stderr.join(""), /failed-run log unavailable/);
    assert.match(stderr.join(""), /keeping job-step fingerprints/);
    assert.match(stdout.join(""), /\tjob-step\t/);
    const rows = stdout.join("").trimEnd().split("\n").slice(1);
    assert.ok(rows.length > 0);
    assert.ok(rows.every((line) => line.split("\t")[9] !== "test"));
  });

  it("does not expose failed-log stderr in warnings", async () => {
    const stderr: string[] = [];
    const exitCode = await runCiRedReportCli({
      api: fixtureApi([]),
      failedRunLog: () => {
        throw new Error(
          "download failed https://logs.example.invalid/download/opaque?sig=redacted",
        );
      },
      now,
      stdout: () => {},
      stderr: (text) => stderr.push(text),
    });

    assert.equal(exitCode, 0);
    assert.match(stderr.join(""), /failed-run log unavailable/);
    assert.doesNotMatch(stderr.join(""), /logs\.example\.invalid/);
  });

  it("stops scheduling queued job queries after an API failure", async () => {
    const runIds = Array.from({ length: 10 }, (_, index) => 100 + index);
    const requestedJobs: number[] = [];
    const stderr: string[] = [];
    const exitCode = await runCiRedReportCli({
      api: (endpoint) => {
        if (endpoint.includes("event=push")) {
          return paged(
            "workflow_runs",
            runIds.map((id) => run(id)),
          );
        }
        if (endpoint.includes("event=schedule")) {
          return paged("workflow_runs", []);
        }
        const match = endpoint.match(/actions\/runs\/(\d+)\/jobs/);
        if (!match) throw new Error(`unexpected endpoint ${endpoint}`);
        const runId = Number(match[1]);
        requestedJobs.push(runId);
        if (runId === 100) throw new Error("job query failed");
        return paged("jobs", [job(runId, runId * 10, { run_id: runId })]);
      },
      now,
      stderr: (text) => stderr.push(text),
      stdout: () => assert.fail("a partial report must not be printed"),
    });

    assert.equal(exitCode, 2);
    assert.match(stderr.join(""), /job query failed/);
    assert.equal(requestedJobs.length, 8);
    assert.equal(requestedJobs.includes(108), false);
    assert.equal(requestedJobs.includes(109), false);
  });

  it("exits 2 loudly without stdout when the API cannot be inspected", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCiRedReportCli({
      api: () => {
        throw new Error("gh: authentication required");
      },
      now,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    assert.equal(exitCode, 2);
    assert.deepEqual(stdout, []);
    assert.equal(
      stderr[0],
      "[ci-red-report] could not inspect CI failures: gh: authentication required\n",
    );
  });

  it("exits 2 when paginated API output cannot account for total_count", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCiRedReportCli({
      api: (endpoint) => {
        if (endpoint.includes("event=push")) {
          return JSON.stringify([
            { total_count: 101, workflow_runs: [run(1)] },
          ]);
        }
        return paged("workflow_runs", []);
      },
      now,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    assert.equal(exitCode, 2);
    assert.deepEqual(stdout, []);
    assert.match(stderr.join(""), /pagination is incomplete \(1 of 101 rows/);
  });

  it("retries a workflow query when the run count changes during pagination", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let pushQueries = 0;
    const exitCode = await runCiRedReportCli({
      api: (endpoint) => {
        if (endpoint.includes("event=push")) {
          pushQueries += 1;
          if (pushQueries === 1) {
            return JSON.stringify([
              { total_count: 1, workflow_runs: [run(10)] },
              { total_count: 2, workflow_runs: [run(15)] },
            ]);
          }
          return paged("workflow_runs", [run(10)]);
        }
        if (endpoint.includes("event=schedule")) {
          return paged("workflow_runs", []);
        }
        if (endpoint.includes("actions/runs/10/jobs")) {
          return paged("jobs", [job(10, 101)]);
        }
        throw new Error(`unexpected endpoint ${endpoint}`);
      },
      failedRunLog: () => "captured failed-run log without test annotations",
      now,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    assert.equal(exitCode, 0);
    assert.equal(pushQueries, 2);
    assert.deepEqual(stderr, []);
    const [header, line] = stdout[0].trimEnd().split("\n");
    const runsJsonIndex = header.split("\t").indexOf("runs_json");
    assert.deepEqual(
      JSON.parse(line.split("\t")[runsJsonIndex]).map(
        ({ runId }: { runId: number }) => runId,
      ),
      [10],
    );
  });

  it("exits 2 when gh returns malformed API JSON", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCiRedReportCli({
      api: () => "{not json",
      now,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    assert.equal(exitCode, 2);
    assert.deepEqual(stdout, []);
    assert.match(
      stderr.join(""),
      /could not inspect CI failures: (?:push|schedule) main workflow runs: gh api returned malformed JSON/,
    );
  });

  it("fails closed at GitHub's 1,000-result query ceiling", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cappedPages = Array.from({ length: 10 }, () => ({
      total_count: 1000,
      workflow_runs: Array.from({ length: 100 }, () => ({})),
    })).concat([{ total_count: 0, workflow_runs: [] }]);
    const exitCode = await runCiRedReportCli({
      api: (endpoint) => {
        const range = endpoint.match(/created=([^&]+)&per_page=/)?.[1];
        const [start, end] = range?.split("..") ?? [];
        const startDay = start?.slice(0, 10);
        const endDay = end?.slice(0, 10);
        if (
          endpoint.includes("event=push") &&
          startDay &&
          endDay &&
          startDay <= "2026-10-06" &&
          endDay >= "2026-10-06"
        ) {
          return JSON.stringify(cappedPages);
        }
        return paged("workflow_runs", []);
      },
      now,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    assert.equal(exitCode, 2);
    assert.deepEqual(stdout, []);
    assert.match(
      stderr.join(""),
      /single calendar day 2026-10-06 reached GitHub's 1000-row search limit/,
    );
  });

  it("splits capped date windows before declaring results incomplete", async () => {
    const endpoints: string[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cappedPages = Array.from({ length: 10 }, () => ({
      total_count: 1000,
      workflow_runs: Array.from({ length: 100 }, () => ({})),
    })).concat([{ total_count: 0, workflow_runs: [] }]);
    const exitCode = await runCiRedReportCli({
      api: (endpoint) => {
        endpoints.push(endpoint);
        return endpoint.includes("event=push") &&
          endpoint.includes("2026-08-27..2026-10-06")
          ? JSON.stringify(cappedPages)
          : paged("workflow_runs", []);
      },
      now,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(stderr, []);
    assert.equal(stdout.length, 1);
    assert.equal(endpoints.length, 4);
    assert.ok(
      endpoints.some((endpoint) => endpoint.includes("2026-08-27..2026-09-15")),
    );
    assert.ok(
      endpoints.some((endpoint) => endpoint.includes("2026-09-16..2026-10-06")),
    );
  });
});
