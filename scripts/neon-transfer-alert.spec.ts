import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import {
  extractConsumptionRows,
  findTransferAlerts,
  liveBacktestRange,
  publishDailyTransferAlerts,
  type TransferPoint,
} from "./neon-transfer-alert.js";

const projectNames = new Map([["quiet-project", "Quiet Project"]]);

describe("Neon transfer alert", () => {
  it("uses the last 28 complete UTC days for live backtests", () => {
    assert.deepEqual(liveBacktestRange(new Date("2026-10-01T12:00:00Z")), {
      from: "2026-09-03",
      to: "2026-09-30",
    });
  });

  it("parses the documented project-period-consumption response shape", () => {
    const points = extractConsumptionRows(
      {
        projects: [
          {
            project_id: "quiet-project",
            periods: [
              {
                consumption: [
                  {
                    timeframe_start: "2026-09-21T00:00:00Z",
                    timeframe_end: "2026-09-22T00:00:00Z",
                    metrics: [
                      { metric_name: "compute_unit_seconds", value: 12 },
                      {
                        metric_name: "public_network_transfer_bytes",
                        value: 180_000_000_000,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      projectNames,
    );

    assert.deepEqual(points, [
      {
        projectId: "quiet-project",
        projectName: "Quiet Project",
        date: "2026-09-21",
        bytes: 180_000_000_000,
      },
    ]);
  });

  it("rejects incomplete consumption responses instead of turning unavailable projects into zero", () => {
    assert.throws(
      () =>
        extractConsumptionRows(
          { projects: [], unavailable: ["quiet-project"] },
          projectNames,
        ),
      /consumption response was incomplete/,
    );
  });

  it("alerts only when the daily and trailing-median thresholds are both exceeded", () => {
    const baseline: TransferPoint[] = Array.from({ length: 7 }, (_, index) => ({
      projectId: "p1",
      projectName: "Example",
      date: `2026-09-0${index + 1}`,
      bytes: 10_000_000_000,
    }));
    const thresholdOnly = {
      projectId: "p1",
      projectName: "Example",
      date: "2026-09-08",
      bytes: 50_000_000_000,
    };
    assert.equal(findTransferAlerts([...baseline, thresholdOnly]).length, 0);

    const qualifying = { ...thresholdOnly, bytes: 50_000_000_001 };
    assert.equal(findTransferAlerts([...baseline, qualifying]).length, 1);
  });

  it("does not use missing dates as zero-valued median observations", () => {
    const incompleteBaseline: TransferPoint[] = [1, 2, 4, 5, 6, 7].map(
      (day) => ({
        projectId: "p1",
        projectName: "Example",
        date: `2026-09-${String(day).padStart(2, "0")}`,
        bytes: 0,
      }),
    );
    const qualifying = {
      projectId: "p1",
      projectName: "Example",
      date: "2026-09-08",
      bytes: 60_000_000_000,
    };
    assert.equal(
      findTransferAlerts([...incompleteBaseline, qualifying]).length,
      0,
    );
  });

  it("publishes confirmed project alerts while reporting another project's missing baseline", async () => {
    const completeProject: TransferPoint[] = Array.from(
      { length: 8 },
      (_, index) => ({
        projectId: "confirmed",
        projectName: "Confirmed",
        date: `2026-09-${String(index + 1).padStart(2, "0")}`,
        bytes: index === 7 ? 1_000_000_000_001 : 10_000_000_000,
      }),
    );
    const incompleteProject: TransferPoint[] = [1, 2, 4, 5, 6, 7, 8].map(
      (day) => ({
        projectId: "incomplete",
        projectName: "Incomplete",
        date: `2026-09-${String(day).padStart(2, "0")}`,
        bytes: day === 8 ? 60_000_000_000 : 10_000_000_000,
      }),
    );
    let posted:
      | { alerts: unknown[]; incompleteBaselines: string[] }
      | undefined;

    const result = await publishDailyTransferAlerts(
      [...completeProject, ...incompleteProject],
      "2026-09-08",
      true,
      async (alerts, incompleteBaselines) => {
        posted = { alerts, incompleteBaselines };
      },
    );

    assert.equal(result.alerts.length, 1);
    assert.deepEqual(result.incompleteBaselines, ["Incomplete"]);
    assert.equal(posted?.alerts.length, 1);
    assert.deepEqual(posted?.incompleteBaselines, ["Incomplete"]);
  });

  it("runs the full synthetic September scenario backtest without posting", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/neon-transfer-alert.ts",
        "--backtest",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          NEON_API_KEY: "",
          SLACK_NEON_TRANSFER_WEBHOOK_URL: "",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /not a live Neon API sample/i);
    assert.match(result.stdout, /2026-09-03  Docs/);
    assert.match(result.stdout, /2026-09-08  Design/);
    assert.match(result.stdout, /2026-09-21  Mail/);
  });

  it("returns could-not-run for a missing API key", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/neon-transfer-alert.ts",
        "--dry-run",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          NEON_API_KEY: "",
          SLACK_NEON_TRANSFER_WEBHOOK_URL: "",
        },
      },
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /NEON_API_KEY required/);
  });

  it("returns could-not-run when the Slack webhook is missing for a send", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/neon-transfer-alert.ts",
        "--send",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          NEON_API_KEY: "test-placeholder-key",
          SLACK_NEON_TRANSFER_WEBHOOK_URL: "",
        },
      },
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /SLACK_NEON_TRANSFER_WEBHOOK_URL is required/);
  });

  it("returns could-not-run for a live backtest without the Neon API key", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/neon-transfer-alert.ts",
        "--backtest-live",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          NEON_API_KEY: "",
          NEON_ORG_ID: "",
          SLACK_NEON_TRANSFER_WEBHOOK_URL: "",
        },
      },
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /NEON_API_KEY required for the live backtest/);
  });

  it("rejects Slack sending for either backtest mode", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/neon-transfer-alert.ts",
        "--backtest-live",
        "--send",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Backtests never send Slack alerts/);
  });
});
