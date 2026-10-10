import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const WORKFLOW_DIR = ".github/workflows";

export const workflowPaths = readdirSync(WORKFLOW_DIR)
  .filter((name) => /\.ya?ml$/i.test(name))
  .sort()
  .map((name) => `${WORKFLOW_DIR}/${name}`);

export const reporterWorkflows = [
  ".github/workflows/beta-e2e-scheduled.yml",
  ".github/workflows/keep-neon-warm.yml",
  ".github/workflows/signup-e2e-scheduled.yml",
  ".github/workflows/signup-agent-scheduled.yml",
] as const;

const fullReportArtifactNames: Record<
  (typeof reporterWorkflows)[number],
  string
> = {
  ".github/workflows/beta-e2e-scheduled.yml": "beta-e2e-digest-",
  ".github/workflows/keep-neon-warm.yml": "production-health-report-",
  ".github/workflows/signup-e2e-scheduled.yml": "signup-e2e-report-",
  ".github/workflows/signup-agent-scheduled.yml": "signup-agent-",
};

export const supportingWorkflows = [".github/workflows/beta-e2e.yml"] as const;

function retainsFullReportArtifact(path: string, source: string): boolean {
  const artifactName = fullReportArtifactNames[path];
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

const visualRecapCommentWorkflows = new Set([
  ".github/workflows/pr-visual-recap.yml",
  ".github/workflows/pr-visual-recap-reusable.yml",
  ".github/workflows/pr-visual-recap-fork.yml",
]);

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

export function inspectAutomatedFindingWorkflows(
  workflows: Record<string, string>,
): string[] {
  const problems: string[] = [];
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
    if (!/SLACK_CHANNEL:\s*C0C4U4XRT6X\b/.test(source)) {
      problems.push(`${path} must route its report to #qa-agent-native.`);
    }
    if (!retainsFullReportArtifact(path, source)) {
      problems.push(
        `${path} must retain its complete report artifact for 90 days.`,
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
  for (const path of supportingWorkflows) {
    const source = workflows[path];
    if (source === undefined) {
      problems.push(`${path} is missing from the automated reporter guard.`);
      continue;
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
  const problems = inspectAutomatedFindingWorkflows(workflows);
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
