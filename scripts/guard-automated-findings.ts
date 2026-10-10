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
    description: "gh issue create command",
    pattern: /\bgh\s+issue\s+create\b/i,
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
  const explicitMethod =
    /(?:--method\b|--request\b|-X)(?:\s*=\s*|\s+|(?=[A-Za-z]))([A-Za-z]+)\b/i;
  const ghFields =
    /(?:^|\s)(?:-f|-F|--field|--raw-field)(?:(?:=|\s+)\s*)?(?:title|body)=/i;
  const requestBody =
    /(?:^|\s)(?:(?:-d|-F)(?:\s+|=|(?=\S))|(?:--data(?:-raw|-binary|-urlencode|-ascii)?|--json|--form|--post-data|--post-file)(?:\s+|=|(?=["'])))/i;

  return source.split(/\r?\n/).some((line) => {
    if (!issueEndpoint.test(line)) return false;

    const method = line.match(explicitMethod)?.[1]?.toUpperCase();
    if (/\bgh\s+api\b/i.test(line)) {
      if (method) return method === "POST";
      return ghFields.test(line);
    }
    if (/\b(?:curl|wget)\b/i.test(line)) {
      if (method) return method === "POST";
      return requestBody.test(line);
    }
    return false;
  });
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
