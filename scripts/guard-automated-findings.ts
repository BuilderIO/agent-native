import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const WORKFLOW_DIR = ".github/workflows";

export const workflowPaths = readdirSync(WORKFLOW_DIR)
  .filter((name) => /\.ya?ml$/i.test(name))
  .sort()
  .map((name) => `${WORKFLOW_DIR}/${name}`);

export const reporterWorkflows = [
  ".github/workflows/beta-e2e-report.yml",
  ".github/workflows/design-e2e.yml",
  ".github/workflows/keep-neon-warm.yml",
  ".github/workflows/signup-e2e-scheduled.yml",
  ".github/workflows/signup-agent-scheduled.yml",
] as const;

const fullReportArtifactNames: Record<
  (typeof reporterWorkflows)[number],
  string
> = {
  ".github/workflows/beta-e2e-report.yml": "beta-e2e-digest-",
  ".github/workflows/design-e2e.yml": "design-e2e-scheduled-report-",
  ".github/workflows/keep-neon-warm.yml": "production-health-report-",
  ".github/workflows/signup-e2e-scheduled.yml": "signup-e2e-report-",
  ".github/workflows/signup-agent-scheduled.yml":
    "signup-agent-${{ github.run_id }}",
};

export const supportingWorkflows = [
  ".github/workflows/beta-e2e-scheduled.yml",
  ".github/workflows/beta-e2e.yml",
] as const;

// This reports release promotion failures, not application or CI findings.
const scheduledNonFindingSlackWorkflows = new Set([
  ".github/workflows/release-everything.yml",
]);

function retainsFullReportArtifact(path: string, source: string): boolean {
  const artifactName =
    fullReportArtifactNames[path as keyof typeof fullReportArtifactNames];
  if (!artifactName) return false;
  const steps = source.split(/^      - /m);
  return steps.some((step) => {
    if (!/uses:\s*actions\/upload-artifact@/.test(step)) return false;
    const options = step.match(
      /^        with:\s*\n((?:          [^\n]*\n?)*)/m,
    )?.[1];
    if (!options) return false;
    const name = options.match(
      /^          name:\s*["']?([^"'\n]+)["']?\s*$/m,
    )?.[1];
    const retention = options.match(
      /^          retention-days:\s*["']?(\d+)["']?\s*$/m,
    )?.[1];
    return name?.startsWith(artifactName) === true && retention === "90";
  });
}

function requiresHealthReportArtifact(source: string): string[] {
  const artifactOutcome = "steps.health-report-artifact.outcome == 'success'";
  const artifactUrl = "steps.health-report-artifact.outputs.artifact-url != ''";
  const requiredSteps = [
    "Attach the report artifact to the pending health notification",
    "Post the incident transition or recovery to #qa-agent-native",
    "Acknowledge the Slack report in durable state",
    "Acknowledge the degraded state warning",
  ];
  const steps = source.split(/^      - /m);
  const problems: string[] = [];

  for (const name of requiredSteps) {
    const step = steps.find((candidate) =>
      candidate.startsWith(`name: ${name}\n`),
    );
    if (
      !step ||
      !step.includes(artifactOutcome) ||
      !step.includes(artifactUrl)
    ) {
      problems.push(name);
    }
  }

  return problems;
}

function requiresSignupRecoveryState(path: string, source: string): string[] {
  const reporter =
    path === ".github/workflows/signup-e2e-scheduled.yml"
      ? {
          kind: "e2e",
          plan: "Plan the Signup E2E recovery rollup",
          finalize: "Finalize Signup E2E continuity state",
          persist: "Persist Signup E2E continuity state",
          artifact:
            "signup-e2e-continuity-${{ github.run_id }}-${{ github.run_attempt }}",
        }
      : path === ".github/workflows/signup-agent-scheduled.yml"
        ? {
            kind: "agent",
            plan: "Plan the Signup agent recovery rollup",
            finalize: "Finalize Signup agent continuity state",
            persist: "Persist Signup agent continuity state",
            artifact:
              "signup-agent-continuity-${{ github.run_id }}-${{ github.run_attempt }}",
          }
        : null;
  if (!reporter) return [];

  const steps = source.split(/^      - /m);
  const step = (name: string) =>
    steps.find((candidate) => candidate.startsWith(`name: ${name}\n`));
  const required = [
    "Restore the previous scheduled report state",
    reporter.plan,
    reporter.finalize,
    reporter.persist,
  ];
  const missing = required.filter((name) => !step(name));
  const recoveryPlan = step(reporter.plan);
  const restore = step("Restore the previous scheduled report state");
  const finalize = step(reporter.finalize);
  const persist = step(reporter.persist);
  const slackConfig = step("Check Slack configuration");

  if (!recoveryPlan?.includes("--previous-state")) {
    missing.push(`${reporter.plan} must consume persisted prior state`);
  }
  if (
    !restore?.includes("gh run download") ||
    !recoveryPlan?.includes("steps.previous-state.outcome == 'success'")
  ) {
    missing.push(
      `${reporter.plan} must require a successfully restored prior state artifact`,
    );
  }
  if (
    !finalize?.includes(`finalize-${reporter.kind}`) ||
    !finalize.includes("--slack-delivered") ||
    !finalize.includes("steps.slack.outputs.ok")
  ) {
    missing.push(
      `${reporter.finalize} must retain recovery state until Slack delivery succeeds`,
    );
  }
  if (
    !persist?.includes(reporter.artifact) ||
    !persist.includes("retention-days: 90") ||
    !persist.includes("if-no-files-found: error") ||
    !persist.includes("github.event_name == 'schedule'")
  ) {
    missing.push(
      `${reporter.persist} must upload durable state with 90-day retention`,
    );
  }
  if (
    !slackConfig?.includes("steps.continuity-plan.outputs.recovered == 'true'")
  ) {
    missing.push("Slack configuration must include the recovery rollup");
  }
  return missing;
}

const visualRecapCommentWorkflows = new Set([
  ".github/workflows/pr-visual-recap.yml",
  ".github/workflows/pr-visual-recap-reusable.yml",
  ".github/workflows/pr-visual-recap-fork.yml",
]);

// These workflows and recap-cli update only their own sticky PR recap comment.
const visualRecapCommentSources = new Set(["packages/recap-cli/src/recap.ts"]);
const visualRecapCommentMutationDescriptions = new Set([
  "GitHub Issues API POST request",
  "GitHub Issues API PATCH request",
  "GitHub Issues API createComment call",
  "GitHub Issues API updateComment call",
  "GitHub GraphQL addComment mutation",
]);

// The Factory babysitter posts a status comment to an already-known pull request.
const factoryPullRequestCommentCallSite =
  "templates/factory/actions/babysit-factory-pull-request.ts";
const factoryGitHubClient = "templates/factory/server/triage/github-client.ts";

const sourceRoots = ["packages", "scripts", "templates"] as const;
const sourceExtensions = /\.(?:[cm]?[jt]sx?|sh|bash|py|rb|go)$/i;
const ignoredSourceDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "dist",
  "node_modules",
  "out",
]);
const ignoredSourcePaths = /(?:^|\/)(?:__tests__|fixtures?|tests?)(?:\/|$)/i;
const testSourcePath = /\.(?:spec|test)\.(?:[cm]?[jt]sx?|sh|bash|py|rb|go)$/i;
// The guard contains the write signatures it matches, but is not a writer.
const guardSourcePath = "scripts/guard-automated-findings.ts";

function findSourcePaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      return ignoredSourceDirectories.has(entry.name)
        ? []
        : findSourcePaths(path);
    }
    return sourceExtensions.test(entry.name) &&
      !ignoredSourcePaths.test(path) &&
      path !== guardSourcePath &&
      !testSourcePath.test(entry.name)
      ? [path]
      : [];
  });
}

export const sourcePaths = sourceRoots
  .flatMap((root) => findSourcePaths(root))
  .sort();

const issueWritePermission =
  /(?:^\s*issues\s*:\s*['"]?write['"]?\s*(?:#.*)?$|\bissues\s*:\s*['"]?write['"]?\s*[},])/m;
const writeAllPermission =
  /^\s*permissions\s*:\s*['"]?write-all['"]?\s*(?:#.*)?$/m;
const issueCreationOperations = [
  {
    description: "gh issue create/new command",
    pattern: /\bgh\s+issue\s+(?:create|new)\b/i,
  },
  {
    description: "GitHub Issues API creation call",
    pattern:
      /(?:github|octokit)(?:\.rest)?\.issues\.create\s*\(|\bissues\.create\s*\(/i,
  },
  {
    description: "GitHub Issues API POST request",
    pattern:
      /\brequest\s*\(\s*["']POST\s+\/repos\/[^/]+\/[^/]+\/issues(?:$|[\s"'`?])|\b(?:axios|requests|httpx)\.post\s*\([^\n]*\/repos\/[^/\s"'`]+\/[^/\s"'`]+\/issues(?:$|[\s"'`?])|\bfetch\s*\(\s*["'`][^"'`]*\/repos\/[^/\s"'`]+\/[^/\s"'`]+\/issues(?:$|[?"'`])[^\n]*\bmethod\s*:\s*["'`]POST/i,
  },
  {
    description: "GitHub issue creation action",
    pattern:
      /^\s*uses:\s*[^\n]*(?:(?:create|new)[-_](?:[\w]+[-_]){0,3}issues?|issues?[-_].*(?:create|new))[^\n]*$/im,
  },
];

function postsToGitHubIssues(source: string): boolean {
  const issueEndpoint =
    /(?:^|[\/\s"'`])repos\/[^\s"'`]*\/issues(?:[?\s"'`]|$)/i;
  const longMethod = /(?:--method\b|--request\b)(?:\s*=\s*|\s+)([A-Za-z]+)\b/i;
  const shortMethod = /(?:^|\s)-X(?:\s*=\s*|\s+|(?=[A-Za-z]))([A-Za-z]+)\b/;
  const ghFields =
    /(?:^|\s)(?:-f|-F|--field|--raw-field)(?:(?:=|\s+)\s*)?["']?(?:title|body)=/i;
  const requestBody =
    /(?:^|\s)(?:(?:-d|-F)(?:\s+|=|(?=\S))|(?:--data(?:-raw|-binary|-urlencode|-ascii)?|--json|--form|--post-data|--post-file)(?:\s+|=|(?=["'])))/i;

  if (
    source.split(/\r?\n/).some((line) => {
      if (!issueEndpoint.test(line)) return false;

      const method = (
        line.match(longMethod)?.[1] ?? line.match(shortMethod)?.[1]
      )?.toUpperCase();
      if (/\bgh\s+api\b/i.test(line)) {
        if (method) return method === "POST";
        return ghFields.test(line);
      }
      if (/\b(?:curl|wget)\b/i.test(line)) {
        if (method) return method === "POST";
        return requestBody.test(line);
      }
      return false;
    })
  ) {
    return true;
  }

  const requestCall =
    /\b(fetch|request|(?:axios|requests|httpx)\s*\.\s*(?:post|request))\s*\(/gi;
  for (const match of source.matchAll(requestCall)) {
    const callStart = match.index;
    if (callStart === undefined) continue;
    const openParen = source.indexOf("(", callStart);
    const callEnd = findCallEnd(source, openParen);
    if (callEnd === undefined) continue;

    const call = source.slice(callStart, callEnd + 1);
    if (!issueEndpoint.test(call)) continue;

    const method = match[1]?.toLowerCase();
    if (method?.endsWith(".post")) return true;
    if (
      /\bmethod\s*:\s*["'`]?\s*POST\b/i.test(call) ||
      /^\s*["'`]POST\s+\/repos\//i.test(call.slice(openParen + 1))
    ) {
      return true;
    }
  }

  return false;
}

function findCallEnd(source: string, openParen: number): number | undefined {
  let depth = 0;
  let quote: "'" | '"' | "`" | undefined;
  let escaped = false;

  for (let index = openParen; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return undefined;
}

function createsIssueThroughGraphQL(source: string): boolean {
  const graphqlRequest =
    /\bgh\s+api\b[\s\S]{0,200}?\bgraphql\b|https?:\/\/api\.github\.com\/graphql\b|\b(?:octokit|github)\.graphql\s*\(/i;
  const createIssueMutation = /\bmutation\b[\s\S]*?\bcreateIssue\s*\(/i;
  return graphqlRequest.test(source) && createIssueMutation.test(source);
}

type IssueMutation = { description: string; kind: "comment" | "issue" };

const issueMutationMethods = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const issueCliMutations =
  /\bgh\s+issue\s+(create|new|edit|close|reopen|comment|delete|lock|unlock|pin|unpin|transfer|assign|unassign)\b/gi;
const issueApiMethodCalls =
  /(?:github|octokit)(?:\.rest)?\.issues\s*\.\s*(create|update|delete|createComment|updateComment|deleteComment|addLabels|setLabels|removeLabel|addAssignees|removeAssignees|lock|unlock|addReaction|removeReaction)\s*\(/gi;
const githubIssueMutationHelpers =
  /\b(?:(?:github|octokit|githubClient|githubApi)\s*\.\s*(?:create|update|edit|close|reopen|delete|comment|lock|unlock|add|remove)(?:GitHub|Github)?Issue(?:Comment|Reaction)?|(?:create|update|edit|close|reopen|delete|comment|lock|unlock|add|remove)(?:GitHub|Github)Issue(?:Comment|Reaction)?)\s*\(/gi;
const githubIssueClientMethodDefinitions =
  /\b(?:async\s+)?(?:create|update|edit|close|reopen|delete|comment|lock|unlock|add|remove)(?:GitHub|Github)?Issue(?:Comment|Reaction)?\s*\(/gi;
const issueRoute = /repos\/[^\s"'`]*\/issues(?:[?\/\s"'`]|$)/i;
const issueCommentEndpoint =
  /\/issues\/(?:[^\/\s"'?]+\/)?comments(?:[?\/\s"']|$)/i;

function githubIssueMutations(source: string, path?: string): IssueMutation[] {
  const mutations: IssueMutation[] = [];
  const add = (description: string, kind: IssueMutation["kind"]) => {
    if (!mutations.some((mutation) => mutation.description === description)) {
      mutations.push({ description, kind });
    }
  };

  for (const match of source.matchAll(issueCliMutations)) {
    const operation = match[1]!.toLowerCase();
    add(
      operation === "create" || operation === "new"
        ? "gh issue create/new command"
        : "gh issue " + operation + " command",
      operation === "comment" ? "comment" : "issue",
    );
  }

  for (const match of source.matchAll(issueApiMethodCalls)) {
    const operation = match[1]!;
    add(
      operation === "create"
        ? "GitHub Issues API creation call"
        : "GitHub Issues API " + operation + " call",
      /comment/i.test(operation) ? "comment" : "issue",
    );
  }

  for (const match of source.matchAll(githubIssueMutationHelpers)) {
    const helper = match[0].slice(0, match[0].indexOf("(")).toLowerCase();
    const isComment = helper.includes("comment");
    add(
      isComment
        ? "GitHub issue comment mutation helper"
        : "GitHub issue mutation helper",
      isComment ? "comment" : "issue",
    );
  }

  if (path && /(?:^|\/)github-(?:client|api)\.[cm]?[jt]sx?$/i.test(path)) {
    for (const match of source.matchAll(githubIssueClientMethodDefinitions)) {
      const helper = match[0].toLowerCase();
      const isComment = helper.includes("comment");
      add(
        isComment
          ? "GitHub issue comment writer method"
          : "GitHub issue writer method",
        isComment ? "comment" : "issue",
      );
    }
  }

  const normalizedSource = source.replace(/\\\r?\n[ \t]*/g, " ");
  const longMethod = /(?:--method\b|--request\b)(?:\s*=\s*|\s+)([A-Za-z]+)\b/i;
  const shortMethod = /(?:^|\s)-X(?:\s*=\s*|\s+|(?=[A-Za-z]))([A-Za-z]+)\b/;
  const ghFields =
    /(?:^|\s)(?:-f|-F|--field|--raw-field)(?:(?:=|\s+)\s*)?["']?(?:title|body|state|state_reason|labels|assignees|content)=|(?:^|\s)--input(?:\s|=)/i;
  const requestBody =
    /(?:^|\s)(?:(?:-d|-F)(?:\s+|=|(?=\S))|(?:--data(?:-raw|-binary|-urlencode|-ascii)?|--json|--form|--post-data|--post-file)(?:\s+|=|(?=["'])))/i;

  for (const line of normalizedSource.split(/\r?\n/)) {
    if (!issueRoute.test(line)) continue;
    const method = (
      line.match(longMethod)?.[1] ?? line.match(shortMethod)?.[1]
    )?.toUpperCase();
    if (/\bgh\s+api\b/i.test(line)) {
      if (method && issueMutationMethods.has(method)) {
        add(
          "GitHub Issues API " + method + " request",
          issueCommentEndpoint.test(line) ? "comment" : "issue",
        );
      } else if (!method && ghFields.test(line)) {
        add(
          "GitHub Issues API POST request",
          issueCommentEndpoint.test(line) ? "comment" : "issue",
        );
      }
    } else if (/\b(?:curl|wget)\b/i.test(line)) {
      if (method && issueMutationMethods.has(method)) {
        add(
          "GitHub Issues API " + method + " request",
          issueCommentEndpoint.test(line) ? "comment" : "issue",
        );
      } else if (!method && requestBody.test(line)) {
        add(
          "GitHub Issues API POST request",
          issueCommentEndpoint.test(line) ? "comment" : "issue",
        );
      }
    }
  }

  const requestCall =
    /\b(fetch|request|githubRequest|(?:axios|requests|httpx|ky|got)\s*\.\s*(?:post|patch|put|delete|request))\s*(?:<[^;{}]*>)?\s*\(/gi;
  for (const match of normalizedSource.matchAll(requestCall)) {
    const callStart = match.index;
    if (callStart === undefined) continue;
    const openParen = normalizedSource.indexOf("(", callStart);
    const callEnd = findCallEnd(normalizedSource, openParen);
    if (callEnd === undefined) continue;
    const call = normalizedSource.slice(callStart, callEnd + 1);
    if (!issueRoute.test(call)) continue;

    const method = match[1]!.toLowerCase().split(".").at(-1)!;
    const explicitMethod = (
      call.match(/\bmethod\s*:\s*["']?\s*([A-Za-z]+)\b/i)?.[1] ??
      call.match(/^\s*["']([A-Za-z]+)\s+\/repos\//i)?.[1]
    )?.toUpperCase();
    const requestMethod = ["POST", "PATCH", "PUT", "DELETE"].includes(
      method.toUpperCase(),
    )
      ? method.toUpperCase()
      : explicitMethod;
    if (!requestMethod || !issueMutationMethods.has(requestMethod)) continue;
    add(
      requestMethod === "POST"
        ? "GitHub Issues API POST request"
        : "GitHub Issues API " + requestMethod + " request",
      issueCommentEndpoint.test(call) ? "comment" : "issue",
    );
  }

  const graphqlRequest =
    /\bgh\s+api\b[\s\S]{0,200}?\bgraphql\b|https?:\/\/api\.github\.com\/graphql\b|\b(?:octokit|github)\.graphql\s*\(/i;
  const graphqlIssueMutation =
    /\bmutation\b[\s\S]*?\b(?:create|update|close|reopen|delete|add|remove|lock|unlock)\w*(?:Issue|Comment)\w*\s*\(/i;
  if (graphqlRequest.test(source) && graphqlIssueMutation.test(source)) {
    const mutation = source.match(graphqlIssueMutation)?.[0] ?? "";
    const isComment = /comment/i.test(mutation);
    const operation = mutation.match(/\b(addComment)\s*\(/i)?.[1];
    add(
      isComment
        ? operation
          ? "GitHub GraphQL " + operation + " mutation"
          : "GitHub GraphQL issue comment mutation"
        : /createIssue/i.test(mutation)
          ? "GitHub GraphQL createIssue mutation"
          : "GitHub GraphQL issue mutation",
      isComment ? "comment" : "issue",
    );
  }

  const issueMutationActions =
    /^\s*uses:\s*[^\n]*(?:(?:create|new|update|edit|close|reopen|comment|delete|lock|unlock)[-_](?:[\w]+[-_]){0,3}issues?|issues?[-_].*(?:create|new|update|edit|close|reopen|delete|lock|unlock))[^\n]*$/im;
  if (issueMutationActions.test(normalizedSource)) {
    add("GitHub issue mutation action", "issue");
  }

  return mutations;
}

function hasOnlyFactoryPullRequestCommentCallsites(
  sources: Record<string, string>,
): boolean {
  const callsites: Array<{ path: string; pullRequestBound: boolean }> = [];
  const callPattern = /\bgithub\.createIssueComment\s*\(/gi;
  for (const [path, source] of Object.entries(sources)) {
    for (const match of source.matchAll(callPattern)) {
      if (match.index === undefined) continue;
      const openParen = source.indexOf("(", match.index);
      const callEnd = findCallEnd(source, openParen);
      const call =
        callEnd === undefined ? "" : source.slice(match.index, callEnd + 1);
      callsites.push({
        path,
        pullRequestBound: /,\s*pullRequestNumber\s*,/.test(call),
      });
    }
  }

  return (
    callsites.length > 0 &&
    callsites.every(
      (callsite) =>
        callsite.path === factoryPullRequestCommentCallSite &&
        callsite.pullRequestBound,
    )
  );
}

function isFactoryPrCommentClientMethod(source: string): boolean {
  const methods = [...source.matchAll(githubIssueClientMethodDefinitions)].map(
    (match) => match[0].replace(/^async\s+/, "").replace(/\s*\($/, ""),
  );
  return methods.length === 1 && methods[0] === "createIssueComment";
}

function issueWriteKindIsAllowed(
  path: string,
  source: string,
  mutation: IssueMutation,
  allSources: Record<string, string>,
): boolean {
  if (
    mutation.kind === "comment" &&
    mutation.description === "GitHub issue comment mutation helper" &&
    path === factoryPullRequestCommentCallSite
  ) {
    const callPattern = /\bgithub\.createIssueComment\s*\(/gi;
    const calls = [...source.matchAll(callPattern)];
    if (calls.length !== 1 || calls[0]?.index === undefined) return false;
    const openParen = source.indexOf("(", calls[0].index);
    const callEnd = findCallEnd(source, openParen);
    const call =
      callEnd === undefined ? "" : source.slice(calls[0].index, callEnd + 1);
    return (
      /,\s*pullRequestNumber\s*,/.test(call) &&
      hasOnlyFactoryPullRequestCommentCallsites(allSources)
    );
  }
  if (
    mutation.kind === "comment" &&
    mutation.description === "GitHub issue comment writer method" &&
    path === factoryGitHubClient
  ) {
    return (
      isFactoryPrCommentClientMethod(source) &&
      hasOnlyFactoryPullRequestCommentCallsites(allSources)
    );
  }

  return (
    mutation.kind === "comment" &&
    visualRecapCommentMutationDescriptions.has(mutation.description) &&
    (visualRecapCommentWorkflows.has(path) ||
      visualRecapCommentSources.has(path))
  );
}

function hasQaReporterTarget(path: string, source: string): boolean {
  return path === ".github/workflows/design-e2e.yml"
    ? /--arg channel C0C4U4XRT6X\b/.test(source)
    : /SLACK_CHANNEL:\s*C0C4U4XRT6X\b/.test(source);
}

function isScheduledReportCandidate(path: string, source: string): boolean {
  return (
    /^\s*schedule\s*:/m.test(source) &&
    !scheduledNonFindingSlackWorkflows.has(path) &&
    (/method:\s*chat\.postMessage/.test(source) ||
      /slackapi\/slack-github-action/.test(source) ||
      githubIssueMutations(source, path).length > 0)
  );
}

export function inspectAutomatedFindingWorkflows(
  workflows: Record<string, string>,
  sources: Record<string, string> = {},
): string[] {
  const problems: string[] = [];
  const reporterSet = new Set<string>(reporterWorkflows);
  for (const [path, source] of Object.entries(workflows)) {
    if (isScheduledReportCandidate(path, source) && !reporterSet.has(path)) {
      problems.push(
        path +
          " is a scheduled QA report or GitHub issue writer missing from the complete reporter list.",
      );
    }
  }
  for (const path of reporterWorkflows) {
    const source = workflows[path];
    if (source === undefined) {
      problems.push(`${path} is missing from the automated reporter guard.`);
      continue;
    }

    const slackPosts = source.match(/method:\s*chat\.postMessage/g) ?? [];
    if (slackPosts.length !== 1) {
      problems.push(
        `${path} must send one consolidated report to #qa-agent-native; found ${slackPosts.length} Slack post actions.`,
      );
    }
    if (!hasQaReporterTarget(path, source)) {
      problems.push(`${path} must route its report to #qa-agent-native.`);
    }
    if (!retainsFullReportArtifact(path, source)) {
      problems.push(
        `${path} must retain its complete report artifact for 90 days.`,
      );
    }
    if (path === ".github/workflows/keep-neon-warm.yml") {
      const unguardedSteps = requiresHealthReportArtifact(source);
      if (unguardedSteps.length > 0) {
        problems.push(
          `${path} must require a successful health report artifact upload before report delivery or acknowledgement: ${unguardedSteps.join(", ")}.`,
        );
      }
    }
    const continuityProblems = requiresSignupRecoveryState(path, source);
    if (continuityProblems.length > 0) {
      problems.push(
        `${path} must post and persist one complete recovery rollup: ${continuityProblems.join(", ")}.`,
      );
    }
  }
  for (const [path, source] of Object.entries(workflows)) {
    if (
      (issueWritePermission.test(source) || writeAllPermission.test(source)) &&
      !visualRecapCommentWorkflows.has(path)
    ) {
      problems.push(
        `${path} requests issues: write outside the PR Visual Recap comment allowlist; automated findings belong in #qa-agent-native, not GitHub Issues.`,
      );
    }
    const normalizedSource = source.replace(/\\\r?\n[ \t]*/g, " ");
    if (postsToGitHubIssues(normalizedSource)) {
      problems.push(
        `${path} contains GitHub Issues API POST request; workflow issue creation is forbidden. PR Visual Recap sticky comments remain allowed.`,
      );
    }
    if (createsIssueThroughGraphQL(source)) {
      problems.push(
        `${path} contains GitHub GraphQL createIssue mutation; workflow issue creation is forbidden. PR Visual Recap sticky comments remain allowed.`,
      );
    }
    for (const { description, pattern } of issueCreationOperations) {
      if (pattern.test(normalizedSource)) {
        problems.push(
          `${path} contains ${description}; workflow issue creation is forbidden. PR Visual Recap sticky comments remain allowed.`,
        );
      }
    }
  }
  for (const [path, source] of Object.entries(workflows)) {
    const normalizedSource = source.replace(/\\\r?\n[ \t]*/g, " ");
    for (const mutation of githubIssueMutations(normalizedSource, path)) {
      if (issueWriteKindIsAllowed(path, normalizedSource, mutation, sources))
        continue;
      if (
        mutation.kind === "issue" &&
        (postsToGitHubIssues(normalizedSource) ||
          createsIssueThroughGraphQL(source) ||
          issueCreationOperations.some(({ pattern }) => pattern.test(source)))
      ) {
        continue;
      }
      problems.push(
        path +
          " contains " +
          mutation.description +
          "; automated findings belong in one #qa-agent-native rollup with complete evidence, not GitHub Issues.",
      );
    }
  }
  for (const [path, source] of Object.entries(sources)) {
    for (const mutation of githubIssueMutations(source, path)) {
      if (issueWriteKindIsAllowed(path, source, mutation, sources)) continue;
      problems.push(
        path +
          " contains " +
          mutation.description +
          "; automated findings belong in one #qa-agent-native rollup with complete evidence, not GitHub Issues.",
      );
    }
  }
  for (const path of supportingWorkflows) {
    const source = workflows[path];
    if (source === undefined) {
      problems.push(`${path} is missing from the automated reporter guard.`);
      continue;
    }
    if (!source.includes("uses: ./.github/workflows/beta-e2e-report.yml")) {
      problems.push(
        `${path} must delegate Beta E2E reporting to the shared Slack reporter.`,
      );
    }
    if (
      /reports? failures? to (?:one )?deduplicated issue|GitHub issue fallback is active/i.test(
        source,
      )
    ) {
      problems.push(
        `${path} still describes automated findings as GitHub issue reports; update it to match the Slack rollup.`,
      );
    }
  }
  return problems;
}

function main(): void {
  const workflows = Object.fromEntries(
    workflowPaths.map((path) => [path, readFileSync(path, "utf8")]),
  );
  const sources = Object.fromEntries(
    sourcePaths.map((path) => [path, readFileSync(path, "utf8")]),
  );
  const problems = inspectAutomatedFindingWorkflows(workflows, sources);
  if (problems.length > 0) {
    console.error("guard:automated-findings found problems:\n");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log("guard:automated-findings passed");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `guard:automated-findings could not inspect the reporter workflows: ${message}`,
    );
    process.exitCode = 1;
  }
}
