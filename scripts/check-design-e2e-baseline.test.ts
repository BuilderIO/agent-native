import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const GUARD = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "check-design-e2e-baseline.ts",
);

const workspaces: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "design-e2e-baseline-"));
  workspaces.push(dir);
  return dir;
}

type Status = "expected" | "unexpected" | "flaky" | "skipped";

/** A Playwright JSON report with one describe-nested file and one flat file. */
function report(
  root: string,
  statuses: { nested: Status; flat: Status },
): string {
  const file = path.join(root, "report.json");
  writeFileSync(
    file,
    JSON.stringify({
      suites: [
        {
          title: "canvas-invariants.spec.ts",
          file: "canvas-invariants.spec.ts",
          specs: [],
          suites: [
            {
              title: "inspector reports the truth",
              specs: [
                {
                  title: "setting Y moves the element",
                  tests: [{ status: statuses.nested }],
                },
              ],
            },
          ],
        },
        {
          title: "editor.spec.ts",
          file: "editor.spec.ts",
          specs: [
            {
              title: "left sidebar switches screens",
              tests: [{ status: statuses.flat }],
            },
          ],
        },
      ],
    }),
  );
  return file;
}

function run(
  baselineFile: string,
  args: string[],
): { status: number; output: string } {
  const result = spawnSync("pnpm", ["tsx", GUARD, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_NATIVE_DESIGN_E2E_BASELINE_FILE: baselineFile,
    },
  });
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

after(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

describe("check-design-e2e-baseline", () => {
  it("records failing tests with their describe path", () => {
    const root = workspace();
    const baseline = path.join(root, "baseline.json");
    const { status } = run(baseline, [
      "--report",
      report(root, { nested: "unexpected", flat: "unexpected" }),
      "--update",
    ]);

    assert.equal(status, 0);
    assert.deepEqual(JSON.parse(readFileSync(baseline, "utf8")), {
      "canvas-invariants.spec.ts": [
        "inspector reports the truth › setting Y moves the element",
      ],
      "editor.spec.ts": ["left sidebar switches screens"],
    });
  });

  it("passes when the only failures are the recorded ones", () => {
    const root = workspace();
    const baseline = path.join(root, "baseline.json");
    const reportFile = report(root, {
      nested: "unexpected",
      flat: "unexpected",
    });
    run(baseline, ["--report", reportFile, "--update"]);

    const { status, output } = run(baseline, ["--report", reportFile]);
    assert.equal(status, 0);
    assert.match(output, /No new Design E2E failures/);
  });

  it("fails on a test that was passing and now fails", () => {
    const root = workspace();
    const baseline = path.join(root, "baseline.json");
    run(baseline, [
      "--report",
      report(root, { nested: "unexpected", flat: "expected" }),
      "--update",
    ]);

    const { status, output } = run(baseline, [
      "--report",
      report(root, { nested: "unexpected", flat: "unexpected" }),
    ]);
    assert.equal(status, 1);
    assert.match(output, /left sidebar switches screens/);
  });

  it("does not gate on a flaky test absent from the baseline", () => {
    const root = workspace();
    const baseline = path.join(root, "baseline.json");
    writeFileSync(baseline, "{}\n");

    const { status, output } = run(baseline, [
      "--report",
      report(root, { nested: "flaky", flat: "flaky" }),
    ]);
    assert.equal(status, 0);
    assert.match(output, /flaky/);
  });

  it("exits 2 rather than 0 when there is no report to read", () => {
    const root = workspace();
    const baseline = path.join(root, "baseline.json");
    writeFileSync(baseline, "{}\n");

    const { status } = run(baseline, [
      "--report",
      path.join(root, "absent.json"),
    ]);
    assert.equal(status, 2);
  });

  it("exits 2 when the report ran no suites", () => {
    const root = workspace();
    const baseline = path.join(root, "baseline.json");
    writeFileSync(baseline, "{}\n");
    const empty = path.join(root, "empty.json");
    writeFileSync(empty, JSON.stringify({ suites: [] }));

    const { status, output } = run(baseline, ["--report", empty]);
    assert.equal(status, 2);
    assert.match(output, /refusing to report green/);
  });

  it("exits 2 when no baseline has been recorded", () => {
    const root = workspace();
    const { status } = run(path.join(root, "missing.json"), [
      "--report",
      report(root, { nested: "unexpected", flat: "expected" }),
    ]);
    assert.equal(status, 2);
  });

  it("reports a baseline entry that now passes so it can be pruned", () => {
    const root = workspace();
    const baseline = path.join(root, "baseline.json");
    run(baseline, [
      "--report",
      report(root, { nested: "unexpected", flat: "unexpected" }),
      "--update",
    ]);

    const { status, output } = run(baseline, [
      "--report",
      report(root, { nested: "unexpected", flat: "expected" }),
    ]);
    assert.equal(status, 0);
    assert.match(output, /1 baseline test\(s\) now pass/);
  });
});
