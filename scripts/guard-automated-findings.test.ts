import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  inspectAutomatedFindingWorkflows,
  reporterWorkflows,
  sourcePaths,
  supportingWorkflows,
  workflowPaths,
} from "./guard-automated-findings.ts";

function currentWorkflows(): Record<string, string> {
  return Object.fromEntries(
    workflowPaths.map((path) => [path, readFileSync(path, "utf8")]),
  );
}

function currentSources(): Record<string, string> {
  return Object.fromEntries(
    sourcePaths.map((path) => [path, readFileSync(path, "utf8")]),
  );
}

test("all automated finding reporters send one Slack rollup and no issue writes", () => {
  assert.deepEqual(inspectAutomatedFindingWorkflows(currentWorkflows()), []);
});

test("the live source inventory has no automated GitHub issue writers", () => {
  assert.deepEqual(
    inspectAutomatedFindingWorkflows(currentWorkflows(), currentSources()),
    [],
  );
});

test("scheduled Design E2E is in the complete Slack reporter inventory", () => {
  const workflowPath = ".github/workflows/design-e2e.yml";
  const workflows = currentWorkflows();
  assert.ok(reporterWorkflows.includes(workflowPath));
  assert.match(workflows[workflowPath]!, /name: design-e2e-scheduled-report-/);
  assert.match(workflows[workflowPath]!, /retention-days: 90/);
  assert.match(workflows[workflowPath]!, /--arg channel C0C4U4XRT6X/);
  assert.equal(
    workflows[workflowPath]!.match(/method: chat\.postMessage/g)?.length,
    1,
  );

  workflows[".github/workflows/future-scheduled-findings.yml"] =
    "on:\n  schedule:\n    - cron: '0 * * * *'\n" +
    "steps:\n  - uses: slackapi/slack-github-action@v4\n" +
    "    with:\n      method: chat.postMessage\n";
  assert.match(
    inspectAutomatedFindingWorkflows(workflows).join("\n"),
    /future-scheduled-findings\.yml is a scheduled QA report .* missing from the complete reporter list/,
  );
});

test("issue creation, edits, closes, and comments are forbidden in source files", () => {
  const operations = [
    [
      "gh issue create",
      "gh issue create --title finding",
      /gh issue create\/new command/,
    ],
    [
      "gh issue edit",
      "gh issue edit 42 --title finding",
      /gh issue edit command/,
    ],
    ["gh issue close", "gh issue close 42", /gh issue close command/],
    [
      "Octokit update",
      'await github.rest.issues.update({ issue_number: 42, state: "closed" });',
      /GitHub Issues API update call/,
    ],
    [
      "REST issue PATCH",
      'await fetch("https://api.github.com/repos/org/repo/issues/42", { method: "PATCH" });',
      /GitHub Issues API PATCH request/,
    ],
    [
      "REST comment POST",
      'await fetch("https://api.github.com/repos/org/repo/issues/42/comments", { method: "POST" });',
      /GitHub Issues API POST request/,
    ],
    [
      "REST comment update",
      'await fetch("https://api.github.com/repos/org/repo/issues/comments/99", { method: "PATCH" });',
      /GitHub Issues API PATCH request/,
    ],
    [
      "gh API issue close",
      "gh api repos/org/repo/issues/42 --method PATCH -f state=closed",
      /GitHub Issues API PATCH request/,
    ],
    [
      "gh API reaction body",
      "gh api repos/org/repo/issues/42/reactions --input reaction.json",
      /GitHub Issues API POST request/,
    ],
  ] as const;

  for (const [name, source, expected] of operations) {
    assert.match(
      inspectAutomatedFindingWorkflows(currentWorkflows(), {
        "scripts/future-finding-writer.ts": source,
      }).join("\n"),
      expected,
      name,
    );
  }
});

test("read-only GitHub issue tools remain outside the write guard", () => {
  const problems = inspectAutomatedFindingWorkflows(currentWorkflows(), {
    "templates/brain/server/lib/connectors.ts":
      'await githubApi("/repos/org/repo/issues", { state: "open" });',
    "templates/calendar/server/handlers/pylon.ts":
      'await fetch("https://api.usepylon.com/issues/search", { method: "POST" });',
    "templates/brain/app/routes/ops.tsx":
      'function updateIssue(value: string) { return params.set("issue", value); }',
  });
  assert.deepEqual(problems, []);
});

test("only the intentional Recap PR-comment upsert is allowlisted in source", () => {
  const recapPath = "packages/recap-cli/src/recap.ts";
  const commentUpsert =
    'await fetch("https://api.github.com/repos/org/repo/issues/42/comments", { method: "POST" });';
  assert.deepEqual(
    inspectAutomatedFindingWorkflows(currentWorkflows(), {
      [recapPath]: commentUpsert,
    }),
    [],
  );

  assert.match(
    inspectAutomatedFindingWorkflows(currentWorkflows(), {
      "templates/factory/actions/dispatch-factory-item.ts":
        "await github.createIssueComment(repository, issueNumber, body);",
    }).join("\n"),
    /templates\/factory\/actions\/dispatch-factory-item\.ts contains GitHub issue comment mutation helper/,
  );
  assert.match(
    inspectAutomatedFindingWorkflows(currentWorkflows(), {
      "templates/factory/server/triage/github-client.ts":
        'async createIssue(repository, input) { return request(`${repositoryPath(repository)}/issues`, { method: "POST" }); }',
    }).join("\n"),
    /templates\/factory\/server\/triage\/github-client\.ts contains GitHub issue writer method/,
  );
  assert.match(
    inspectAutomatedFindingWorkflows(currentWorkflows(), {
      [recapPath]:
        'await fetch("https://api.github.com/repos/org/repo/issues/42/comments", { method: "DELETE" });',
    }).join("\n"),
    /packages\/recap-cli\/src\/recap\.ts contains GitHub Issues API DELETE request/,
  );
});

test("Factory PR babysitter comments are allowed only when bound to a PR", () => {
  const clientPath = "templates/factory/server/triage/github-client.ts";
  const babysitterPath =
    "templates/factory/actions/babysit-factory-pull-request.ts";
  const sources: Record<string, string> = {
    [clientPath]:
      'async createIssueComment(repository, issueNumber, body) { return request(`${repositoryPath(repository)}/issues/${issueNumber}/comments`, { method: "POST" }); }',
    [babysitterPath]:
      "await github.createIssueComment(repository, pullRequestNumber, body);",
  };
  assert.deepEqual(
    inspectAutomatedFindingWorkflows(currentWorkflows(), sources),
    [],
  );

  sources[babysitterPath] =
    "await github.createIssueComment(repository, issueNumber, body);";
  assert.match(
    inspectAutomatedFindingWorkflows(currentWorkflows(), sources).join("\n"),
    /babysit-factory-pull-request\.ts contains GitHub issue comment mutation helper/,
  );

  sources[babysitterPath] =
    "await github.createIssueComment(repository, pullRequestNumber, body);";
  sources["templates/factory/actions/dispatch-factory-item.ts"] =
    "await github.createIssueComment(repository, issueNumber, body);";
  assert.match(
    inspectAutomatedFindingWorkflows(currentWorkflows(), sources).join("\n"),
    /dispatch-factory-item\.ts contains GitHub issue comment mutation helper/,
  );
});

test("every reporter retains its full report artifact for 90 days", () => {
  const workflows = currentWorkflows();
  const artifactName = "name: signup-agent-${{ github.run_id }}";
  const steps = workflows[reporterWorkflows[4]].split(/^      - /m);
  const reportStepIndex = steps.findIndex((step) =>
    step.includes(artifactName),
  );
  assert.notEqual(reportStepIndex, -1);
  steps[reportStepIndex] = steps[reportStepIndex]!.replace(
    "retention-days: 90",
    "retention-days: 14",
  );
  workflows[reporterWorkflows[4]] = steps.join("      - ");
  assert.match(
    inspectAutomatedFindingWorkflows(workflows).join("\n"),
    /signup-agent-scheduled\.yml must retain its complete report artifact for 90 days/,
  );
});

test("signup recovery notices require persisted state and successful Slack delivery", () => {
  for (const [workflowPath, continuityName] of [
    [reporterWorkflows[3], "Signup E2E"],
    [reporterWorkflows[4], "Signup agent"],
  ] as const) {
    const workflows = currentWorkflows();
    assert.deepEqual(inspectAutomatedFindingWorkflows(workflows), []);

    workflows[workflowPath] = workflows[workflowPath]!.replace(
      "--slack-delivered",
      "--recovery-delivered",
    );
    assert.match(
      inspectAutomatedFindingWorkflows(workflows).join("\n"),
      new RegExp(
        `${continuityName} continuity state must retain recovery state until Slack delivery succeeds`,
      ),
    );

    const source = currentWorkflows()[workflowPath]!;
    const persistStep = source
      .split(/^      - /m)
      .findIndex((step) =>
        step.includes(`name: Persist ${continuityName} continuity state`),
      );
    const steps = source.split(/^      - /m);
    assert.notEqual(persistStep, -1);
    steps[persistStep] = steps[persistStep]!.replace(
      "retention-days: 90",
      "retention-days: 14",
    );
    workflows[workflowPath] = steps.join("      - ");
    assert.match(
      inspectAutomatedFindingWorkflows(workflows).join("\n"),
      new RegExp(
        `${continuityName} continuity state must upload durable state with 90-day retention`,
      ),
    );
  }
});

test("health report delivery and acknowledgement require the uploaded artifact", () => {
  const workflows = currentWorkflows();
  const workflowPath = reporterWorkflows[2];
  assert.deepEqual(inspectAutomatedFindingWorkflows(workflows), []);

  workflows[workflowPath] = workflows[workflowPath]!.replaceAll(
    "steps.health-report-artifact.outcome == 'success'",
    "steps.health-report-artifact.outcome != 'success'",
  );
  assert.match(
    inspectAutomatedFindingWorkflows(workflows).join("\n"),
    /must require a successful health report artifact upload before report delivery or acknowledgement/,
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
    /future-health-reporter\.yml contains gh issue create\/new command/,
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

  workflows[".github/workflows/future-health-reporter.yml"] =
    "uses: example/close-issue@v1";
  assert.match(
    inspectAutomatedFindingWorkflows(workflows).join("\n"),
    /future-health-reporter\.yml contains GitHub issue mutation action/,
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
    "gh issue new --title finding",
    "gh api repos/$GITHUB_REPOSITORY/issues -f title=finding",
    "github.rest.issues.create({ title: finding })",
    'curl --request POST https://api.github.com/repos/org/repo/issues --data \'{"title":"finding"}\'',
    "uses: JasonEtco/create-an-issue@v2",
  ]) {
    const workflows = currentWorkflows();
    workflows[reporterWorkflows[2]] += `\n${operation}\n`;
    assert.match(
      inspectAutomatedFindingWorkflows(workflows).join("\n"),
      /(?:gh issue create\/new command|GitHub Issues API POST request|GitHub Issues API creation call|GitHub issue creation action)/,
    );
  }
});

test("the guard recognizes implicit and equals-form GitHub API POST requests", () => {
  for (const operation of [
    "gh api --method=POST repos/org/repo/issues --field title=finding",
    'gh api --method=POST repos/org/repo/issues --field "title=finding"',
    "gh api -XPOST /repos/org/repo/issues -F=title=finding",
    "gh api repos/$GITHUB_REPOSITORY/issues --raw-field title=finding",
    'curl --data \'{"title":"finding"}\' https://api.github.com/repos/org/repo/issues',
    'curl -d\'{"title":"finding"}\' https://api.github.com/repos/org/repo/issues',
    "curl -d=title=finding https://api.github.com/repos/org/repo/issues",
    'curl -X=POST https://api.github.com/repos/org/repo/issues --json \'{"title":"finding"}\'',
    'curl -x https://proxy.example --data \'{"title":"finding"}\' https://api.github.com/repos/org/repo/issues',
    "wget --post-data=title=finding https://api.github.com/repos/org/repo/issues",
  ]) {
    const workflows = currentWorkflows();
    workflows[reporterWorkflows[2]] += `\n${operation}\n`;
    assert.match(
      inspectAutomatedFindingWorkflows(workflows).join("\n"),
      /keep-neon-warm\.yml contains GitHub Issues API POST request/,
      operation,
    );
  }

  const workflows = currentWorkflows();
  workflows[reporterWorkflows[2]] +=
    "\ncurl -x https://proxy.example https://api.github.com/repos/org/repo/issues\n";
  assert.doesNotMatch(
    inspectAutomatedFindingWorkflows(workflows).join("\n"),
    /keep-neon-warm\.yml contains GitHub Issues API POST request/,
  );

  workflows[reporterWorkflows[2]] = currentWorkflows()[reporterWorkflows[2]]!;
  workflows[reporterWorkflows[2]] +=
    "\ngh api --method=GET repos/org/repo/issues --field title=search\n";
  assert.doesNotMatch(
    inspectAutomatedFindingWorkflows(workflows).join("\n"),
    /keep-neon-warm\.yml contains GitHub Issues API POST request/,
  );
});

test("the guard recognizes multiline REST issue creation calls", () => {
  for (const operation of [
    `await fetch(
      "https://api.github.com/repos/org/repo/issues",
      {
        method: "POST",
        body: JSON.stringify({ title: "finding" }),
      },
    );`,
    `await axios.post(
      'https://api.github.com/repos/org/repo/issues',
      { title: "finding" },
    );`,
    `await request(
      "POST /repos/org/repo/issues",
      { json: { title: "finding" } },
    );`,
  ]) {
    const workflows = currentWorkflows();
    workflows[reporterWorkflows[2]] += `\n${operation}\n`;
    assert.match(
      inspectAutomatedFindingWorkflows(workflows).join("\n"),
      /keep-neon-warm\.yml contains GitHub Issues API POST request/,
      operation,
    );
  }

  const workflows = currentWorkflows();
  workflows[reporterWorkflows[2]] += `
await fetch(
  "https://api.github.com/repos/org/repo/issues?state=open",
);
`;
  assert.doesNotMatch(
    inspectAutomatedFindingWorkflows(workflows).join("\n"),
    /keep-neon-warm\.yml contains GitHub Issues API POST request/,
  );
});

test("the guard detects GraphQL issue creation without flagging searches or PR comments", () => {
  const workflows = currentWorkflows();
  workflows[".github/workflows/future-health-reporter.yml"] =
    `run: gh api graphql --field query='
    mutation CreateIssue($repositoryId: ID!, $title: String!) {
      createIssue(input: { repositoryId: $repositoryId, title: $title }) {
        issue { id }
      }
    }'
`;
  assert.match(
    inspectAutomatedFindingWorkflows(workflows).join("\n"),
    /future-health-reporter\.yml contains GitHub GraphQL createIssue mutation/,
  );

  workflows[".github/workflows/future-health-reporter.yml"] =
    `run: gh api graphql --field query='
    query FindIssues($search: String!) {
      search(query: $search, type: ISSUE) { issueCount }
    }'
`;
  workflows[".github/workflows/pr-visual-recap.yml"] += `
run: gh api graphql --field query='mutation AddComment($input: AddCommentInput!) {
  addComment(input: $input) { commentEdge { node { id } } }
}'
`;
  assert.doesNotMatch(
    inspectAutomatedFindingWorkflows(workflows).join("\n"),
    /future-health-reporter\.yml contains GitHub GraphQL createIssue mutation/,
  );
  assert.doesNotMatch(
    inspectAutomatedFindingWorkflows(workflows).join("\n"),
    /pr-visual-recap\.yml contains GitHub GraphQL createIssue mutation/,
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
  workflows[reporterWorkflows[4]] = workflows[reporterWorkflows[4]].replace(
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
