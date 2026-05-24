import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { getGitHubConnection } from "../server/lib/github-connection.js";
import { getDispatchIntegrationsUrl } from "../server/lib/dispatch-url.js";

/**
 * Heuristic PR summary for v1. The model-based summarizer ships in v1.1
 * via `sendToAgentChat()` — for v1 we surface deterministic signals from the
 * PR's changed file list:
 *
 *  - **risk**: `high` if migrations / secrets / auth touched, `med` if many
 *    files or many lines changed, `low` otherwise.
 *  - **schemaImpact**: list of file paths matching schema/migration heuristics.
 *  - **suggestedTests**: changed source files that lack a matching test sibling.
 *
 * The `summary` string is a short, factual recap ("X files, Y additions,
 * Z deletions, touches schema") so the AI summary card has something to
 * render before the model summarizer lands.
 */
export default defineAction({
  description:
    "Return a heuristic summary + risk score for a pull request. v1 is " +
    "deterministic (file-path heuristics for schema / secrets / auth + " +
    "diff-size scoring). The model-based summarizer lands in v1.1 via the " +
    "agent chat. Use this for the AI summary card on `/prs/:owner/:repo/:n`.",
  schema: z.object({
    owner: z.string(),
    repo: z.string(),
    number: z.coerce.number().int().positive(),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      throw new Error("Sign in to summarize pull requests.");
    }
    const orgId = getRequestOrgId() || "";

    const octokit = await getGitHubConnection(userEmail, orgId);
    if (!octokit) {
      return {
        connected: false,
        connectHint:
          "GitHub isn't connected to Workbench yet — connect it once in Dispatch and grant Workbench access.",
        connectUrl: getDispatchIntegrationsUrl({
          provider: "github",
          appId: "workbench",
        }),
      };
    }

    const [prRes, filesRes] = await Promise.all([
      octokit.pulls.get({
        owner: args.owner,
        repo: args.repo,
        pull_number: args.number,
      }),
      octokit.pulls.listFiles({
        owner: args.owner,
        repo: args.repo,
        pull_number: args.number,
        per_page: 100,
      }),
    ]);

    const pr = prRes.data;
    const files = filesRes.data;
    const paths = files.map((f) => f.filename);

    const schemaImpact = paths.filter((p) => isSchemaFile(p));
    const secretsHit = paths.filter((p) => looksLikeSecret(p));
    const authHit = paths.filter((p) => looksLikeAuth(p));
    const testFiles = paths.filter((p) => isTestFile(p));
    const sourceFiles = paths.filter(
      (p) => !isTestFile(p) && !p.endsWith(".md") && !p.endsWith(".json"),
    );

    const suggestedTests = suggestTestsFor(sourceFiles, testFiles);

    let risk: "low" | "med" | "high" = "low";
    const riskReasons: string[] = [];
    if (schemaImpact.length > 0) {
      risk = "high";
      riskReasons.push(
        `Touches schema/migration files: ${schemaImpact.slice(0, 3).join(", ")}${schemaImpact.length > 3 ? ", …" : ""}`,
      );
    }
    if (secretsHit.length > 0) {
      risk = "high";
      riskReasons.push(
        `Touches secret-handling files: ${secretsHit.slice(0, 3).join(", ")}`,
      );
    }
    if (authHit.length > 0) {
      risk = risk === "high" ? "high" : "med";
      riskReasons.push(
        `Touches auth/permission files: ${authHit.slice(0, 3).join(", ")}`,
      );
    }
    if (pr.additions + pr.deletions > 1000 && risk === "low") {
      risk = "med";
      riskReasons.push(
        `Large diff (${pr.additions + pr.deletions} lines across ${pr.changed_files} files)`,
      );
    }
    if (suggestedTests.length > 0 && risk === "low") {
      risk = "med";
      riskReasons.push(
        `${suggestedTests.length} source file(s) changed without an obvious sibling test`,
      );
    }

    const summary = buildSummary(pr, files, {
      schemaImpact,
      secretsHit,
      authHit,
    });

    return {
      connected: true,
      owner: args.owner,
      repo: args.repo,
      number: pr.number,
      headSha: pr.head.sha,
      summary,
      risk,
      riskReasons,
      schemaImpact,
      secretsHit,
      authHit,
      suggestedTests,
      counts: {
        files: pr.changed_files,
        additions: pr.additions,
        deletions: pr.deletions,
        commits: pr.commits,
      },
      generatedAt: new Date().toISOString(),
      version: "heuristic-v1",
    };
  },
});

/** Files matching schema/migration patterns (Drizzle, Prisma, raw SQL). */
function isSchemaFile(path: string): boolean {
  return (
    /(^|\/)schema(\.[tj]sx?)?$/i.test(path) ||
    /\/migrations\//.test(path) ||
    /\.sql$/i.test(path) ||
    /\/drizzle\//.test(path) ||
    /\/prisma\//.test(path)
  );
}

/** Files that look like they handle secrets / tokens / passwords. */
function looksLikeSecret(path: string): boolean {
  return /(secret|password|token|credential|vault|\.env)/i.test(path);
}

/** Files that look like they handle auth/permissions. */
function looksLikeAuth(path: string): boolean {
  return /(\/auth\/|auth\.|permission|session|access|oauth)/i.test(path);
}

/** Test file detection (.test., .spec., __tests__/). */
function isTestFile(path: string): boolean {
  return (
    /\.(test|spec)\.[tj]sx?$/.test(path) ||
    /\/__tests__\//.test(path) ||
    /\/tests?\//.test(path)
  );
}

/**
 * For each changed source file, check whether a sibling test file changed in
 * the same diff. Files without a sibling are surfaced as suggested tests.
 */
function suggestTestsFor(sourceFiles: string[], testFiles: string[]): string[] {
  const testBaseNames = new Set(
    testFiles.map((path) => baseNameWithoutSuffix(path)),
  );
  return sourceFiles.filter((path) => {
    const base = baseNameWithoutSuffix(path);
    return !testBaseNames.has(base);
  });
}

function baseNameWithoutSuffix(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.(test|spec)?\.?[tj]sx?$/, "");
}

interface SummaryFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

function buildSummary(
  pr: { changed_files: number; additions: number; deletions: number },
  files: SummaryFile[],
  hits: { schemaImpact: string[]; secretsHit: string[]; authHit: string[] },
): string {
  const parts: string[] = [];
  parts.push(
    `${pr.changed_files} file(s) changed, +${pr.additions} / -${pr.deletions}`,
  );
  if (hits.schemaImpact.length > 0) {
    parts.push(`touches schema (${hits.schemaImpact.length})`);
  }
  if (hits.secretsHit.length > 0) {
    parts.push(`touches secret handling (${hits.secretsHit.length})`);
  }
  if (hits.authHit.length > 0) {
    parts.push(`touches auth surface (${hits.authHit.length})`);
  }
  const top = files
    .slice(0, 3)
    .map((f) => f.filename)
    .join(", ");
  if (top) parts.push(`top files: ${top}`);
  return parts.join(". ") + ".";
}
