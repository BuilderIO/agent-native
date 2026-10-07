import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCiRedRows,
  parseFailedTestNames,
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
    completed_at: "2026-10-05T12:30:00Z",
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
      const range = endpoint.match(
        /created=(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/,
      );
      if (!range) throw new Error(`missing created-date window in ${endpoint}`);
      return paged(
        "workflow_runs",
        fixtureRuns[event].filter((workflowRun) => {
          const created = String(workflowRun.created_at).slice(0, 10);
          return created >= range[1] && created <= range[2];
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
              "chromium / design editor\tRun shard\t2026-10-05T12:20:00Z ##[error] 1) [chromium] › e2e/canvas-invariants.spec.ts:42:1 › group fill persists",
              "chromium / design editor\tRun shard\t2026-10-05T12:20:00Z ##[error] 2) [chromium] › e2e/inspector-styles.spec.ts:88:1 › empty stroke title opens color picker",
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
      "run_id\tattempt\tcreated_at\tconcluded_at\tworkflow\tworkflow_path\tjob\tstep\ttest\tfingerprint_grain\tfingerprint\turl",
    );
    assert.deepEqual(
      lines.slice(1).map((line) => [line.split("\t")[0], line.split("\t")[7]]),
      [
        ["10", "Run shard"],
        ["10", "Run shard"],
        ["15", "Run Design E2E"],
        ["16", "(workflow-level failure)"],
        ["19", "Run Design E2E"],
      ],
    );
    assert.match(
      lines[1].split("\t")[8],
      /canvas-invariants\.spec\.ts.*group fill persists/,
    );
    assert.equal(lines[1].split("\t")[9], "test");
    assert.equal(lines[3].split("\t")[9], "job-step");
    for (const line of lines.slice(1)) {
      assert.match(line.split("\t")[10], /^sha256:[a-f0-9]{64}$/);
    }
    assert.equal(endpoints.length, 7);
    assert.match(
      endpoints[0],
      /branch=main&event=push&status=failure&created=2026-08-27\.\.2026-10-06&per_page=100/,
    );
    assert.match(
      endpoints[1],
      /branch=main&event=schedule&status=failure&created=2026-08-27\.\.2026-10-06&per_page=100/,
    );
    assert.ok(
      endpoints
        .slice(2)
        .every((endpoint) => endpoint.includes("filter=latest&per_page=100")),
    );
    assert.ok(
      lines.some(
        (line) =>
          line.startsWith("15\t1\t2026-09-30") &&
          line.includes("\t2026-10-02T00:00:00.000Z\t"),
      ),
    );
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
    }));
    const exitCode = await runCiRedReportCli({
      api: (endpoint) => {
        const range = endpoint.match(
          /created=(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/,
        );
        if (
          endpoint.includes("event=push") &&
          range &&
          range[1] <= "2026-10-06" &&
          range[2] >= "2026-10-06"
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
    }));
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
