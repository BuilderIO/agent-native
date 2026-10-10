import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  inspectAutomatedFindingWorkflows,
  reporterWorkflows,
  supportingWorkflows,
  workflowPaths,
} from "./guard-automated-findings.ts";

function currentWorkflows(): Record<string, string> {
  return Object.fromEntries(
    workflowPaths.map((path) => [path, readFileSync(path, "utf8")]),
  );
}

test("all automated finding reporters send one Slack rollup and no issue writes", () => {
  assert.deepEqual(inspectAutomatedFindingWorkflows(currentWorkflows()), []);
});

test("every reporter retains its full report artifact for 90 days", () => {
  const workflows = currentWorkflows();
  const artifactName = "name: signup-agent-${{ github.run_id }}";
  const steps = workflows[reporterWorkflows[3]].split(/^      - /m);
  const reportStepIndex = steps.findIndex((step) =>
    step.includes(artifactName),
  );
  assert.notEqual(reportStepIndex, -1);
  steps[reportStepIndex] = steps[reportStepIndex]!.replace(
    "retention-days: 90",
    "retention-days: 14",
  );
  workflows[reporterWorkflows[3]] = steps.join("      - ");
  assert.match(
    inspectAutomatedFindingWorkflows(workflows).join("\n"),
    /signup-agent-scheduled\.yml must retain its complete report artifact for 90 days/,
  );
});

test("unrelated 90-day artifacts do not satisfy full-report retention", () => {
  const workflows = currentWorkflows();
  const steps = workflows[reporterWorkflows[0]].split(/^      - /m);
  const reportStepIndex = steps.findIndex((step) =>
    step.includes("name: beta-e2e-digest-${{ github.run_id }}"),
  );
  assert.notEqual(reportStepIndex, -1);
  steps[reportStepIndex] = steps[reportStepIndex]!.replace(
    "retention-days: 90",
    "retention-days: 14",
  );
  workflows[reporterWorkflows[0]] = [
    ...steps,
    `name: unrelated artifact\n        uses: actions/upload-artifact@v4\n        with:\n          name: unrelated\n          path: report\n          retention-days: 90\n`,
  ].join("      - ");
  assert.match(
    inspectAutomatedFindingWorkflows(workflows).join("\n"),
    /beta-e2e-scheduled\.yml must retain its complete report artifact for 90 days/,
  );
});

test("the guard rejects a workflow with issue write permission", () => {
  const workflows = currentWorkflows();
  workflows[reporterWorkflows[0]] += "\n    issues: write\n";
  assert.match(
    inspectAutomatedFindingWorkflows(workflows).join("\n"),
    /requests issues: write/,
  );
});

test("the guard scans future workflows and permits only the Visual Recap write scopes", () => {
  const workflows = currentWorkflows();
  assert.equal(
    inspectAutomatedFindingWorkflows(workflows).filter((problem) =>
      /issues: write/.test(problem),
    ).length,
    0,
  );
  workflows[".github/workflows/future-health-reporter.yml"] =
    `permissions:\n  issues: write\njobs: { report: { runs-on: ubuntu-latest, steps: [{ run: 'gh issue create --title finding' }] } }`;
  const problems = inspectAutomatedFindingWorkflows(workflows).join("\n");
  assert.match(problems, /future-health-reporter\.yml requests issues: write/);
  assert.match(
    problems,
    /future-health-reporter\.yml contains gh issue create command/,
  );

  workflows[".github/workflows/future-health-reporter.yml"] =
    "permissions: write-all\nrun: gh api \\\n      repos/$GITHUB_REPOSITORY/issues \\\n      --method POST -f title=finding";
  const multilineProblems =
    inspectAutomatedFindingWorkflows(workflows).join("\n");
  assert.match(
    multilineProblems,
    /future-health-reporter\.yml requests issues: write/,
  );
  assert.match(
    multilineProblems,
    /future-health-reporter\.yml contains GitHub Issues API POST request/,
  );

  workflows[".github/workflows/future-health-reporter.yml"] =
    "permissions: { issues: write }\nrun: custom-action-that-opens-an-issue";
  assert.match(
    inspectAutomatedFindingWorkflows(workflows).join("\n"),
    /future-health-reporter\.yml requests issues: write/,
  );
});

test("Visual Recap PR-comment operations are allowlisted, but issue creation is not", () => {
  const workflows = currentWorkflows();
  workflows[".github/workflows/pr-visual-recap.yml"] +=
    "\nrun: github.rest.issues.createComment({ issue_number: 123 })\n";
  workflows[".github/workflows/pr-visual-recap.yml"] +=
    "\nrun: gh api repos/foo/bar/issues/123/comments -f body=summary\n";
  assert.deepEqual(inspectAutomatedFindingWorkflows(workflows), []);

  workflows[".github/workflows/pr-visual-recap.yml"] +=
    "\nrun: github.rest.issues.create({ title: 'finding' })\n";
  assert.match(
    inspectAutomatedFindingWorkflows(workflows).join("\n"),
    /pr-visual-recap\.yml contains GitHub Issues API creation call/,
  );
});

test("the guard rejects GitHub issue commands and API creation", () => {
  for (const operation of [
    "gh issue create --title finding",
    "gh api repos/$GITHUB_REPOSITORY/issues -f title=finding",
    "github.rest.issues.create({ title: finding })",
    'curl --request POST https://api.github.com/repos/org/repo/issues --data \'{"title":"finding"}\'',
    "uses: JasonEtco/create-an-issue@v2",
  ]) {
    const workflows = currentWorkflows();
    workflows[reporterWorkflows[1]] += `\n${operation}\n`;
    assert.match(
      inspectAutomatedFindingWorkflows(workflows).join("\n"),
      /(?:gh issue create command|GitHub Issues API POST request|GitHub Issues API creation call|GitHub issue creation action)/,
    );
  }
});

test("the guard recognizes implicit and equals-form GitHub API POST requests", () => {
  for (const operation of [
    "gh api --method=POST repos/org/repo/issues --field title=finding",
    "gh api -XPOST /repos/org/repo/issues -F=title=finding",
    "gh api repos/$GITHUB_REPOSITORY/issues --raw-field title=finding",
    'curl --data \'{"title":"finding"}\' https://api.github.com/repos/org/repo/issues',
    'curl -d\'{"title":"finding"}\' https://api.github.com/repos/org/repo/issues',
    "curl -d=title=finding https://api.github.com/repos/org/repo/issues",
    'curl -X=POST https://api.github.com/repos/org/repo/issues --json \'{"title":"finding"}\'',
    "wget --post-data=title=finding https://api.github.com/repos/org/repo/issues",
  ]) {
    const workflows = currentWorkflows();
    workflows[reporterWorkflows[1]] += `\n${operation}\n`;
    assert.match(
      inspectAutomatedFindingWorkflows(workflows).join("\n"),
      /keep-neon-warm\.yml contains GitHub Issues API POST request/,
      operation,
    );
  }

  const workflows = currentWorkflows();
  workflows[reporterWorkflows[1]] +=
    "\ngh api --method=GET repos/org/repo/issues --field title=search\n";
  assert.doesNotMatch(
    inspectAutomatedFindingWorkflows(workflows).join("\n"),
    /keep-neon-warm\.yml contains GitHub Issues API POST request/,
  );
});

test("the degraded Beta fallback renders actual Slack line breaks", () => {
  const source = readFileSync(reporterWorkflows[0], "utf8");
  const assignment = source.match(
    /report_text="\$\((printf '%s\\n'[\s\S]*?)\)"/,
  )?.[0];
  assert.ok(
    assignment,
    "fallback report should use printf to create line breaks",
  );

  const result = spawnSync(
    "bash",
    [
      "-c",
      `run_url=https://github.com/org/repo/actions/runs/123\n${assignment}\nprintf '%s' "$report_text"`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.split("\n").length, 5);
  assert.doesNotMatch(result.stdout, /\\n/);
});

test("the Beta workflow persists explicit state availability markers", () => {
  const source = readFileSync(reporterWorkflows[0], "utf8");
  assert.match(source, /_betaE2EStateAvailability: "absent"/);
  assert.match(source, /_betaE2EStateAvailability: "unknown"/);
  assert.doesNotMatch(source, /printf 'null\\n' > [^\n]*state\.json/);
});

test("the guard rejects issue-by-issue Slack posts", () => {
  const workflows = currentWorkflows();
  workflows[reporterWorkflows[2]] = workflows[reporterWorkflows[2]].replace(
    "method: chat.postMessage",
    "method: chat.postMessage\n          method: chat.postMessage",
  );
  assert.match(
    inspectAutomatedFindingWorkflows(workflows).join("\n"),
    /must send one consolidated report/,
  );
});

test("the guard rejects reports routed away from the QA channel", () => {
  const workflows = currentWorkflows();
  workflows[reporterWorkflows[3]] = workflows[reporterWorkflows[3]].replace(
    "SLACK_CHANNEL: C0C4U4XRT6X",
    "SLACK_CHANNEL: COTHER",
  );
  assert.match(
    inspectAutomatedFindingWorkflows(workflows).join("\n"),
    /must route its report to #qa-agent-native/,
  );
});

test("the guard rejects stale issue-reporting guidance in the reusable workflow", () => {
  const workflows = currentWorkflows();
  workflows[supportingWorkflows[0]] +=
    "\nThe scheduled wrapper reports failures to one deduplicated issue.\n";
  assert.match(
    inspectAutomatedFindingWorkflows(workflows).join("\n"),
    /still describes automated findings as GitHub issue reports/,
  );
});
