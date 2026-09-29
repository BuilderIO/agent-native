import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import {
  extractConsumptionRows,
  findTransferAlerts,
  type TransferPoint,
} from "./neon-transfer-alert.js";

const projectNames = new Map([["quiet-project", "Quiet Project"]]);

describe("Neon transfer alert", () => {
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

  it("runs the full synthetic September scenario backtest without posting", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/neon-transfer-alert.ts", "--backtest"],
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
      ["--import", "tsx", "scripts/neon-transfer-alert.ts", "--dry-run"],
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
      ["--import", "tsx", "scripts/neon-transfer-alert.ts", "--send"],
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
});
