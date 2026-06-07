#!/usr/bin/env node
/**
 * Idempotent PR comment helper for the visual recap workflow.
 *
 * Subcommands:
 *   find-plan-id --repo owner/name --issue <n> --token <github-token>
 *   upsert-workflow-comment --repo owner/name --issue <n> --token <github-token>
 *
 * The workflow stores the hosted plan id inside the sticky comment so the next
 * push can replace the same hosted plan instead of publishing a new orphan.
 */

const MARKER = "<!-- pr-visual-recap -->";

type JsonObject = Record<string, unknown>;

type GitHubComment = {
  id: number;
  body?: string | null;
  html_url?: string;
  user?: { type?: string | null } | null;
};

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function stringArg(
  args: Record<string, string | boolean>,
  key: string,
): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing --${key}`);
  }
  return value;
}

function repoParts(repoFullName: string): { owner: string; repo: string } {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) throw new Error(`Invalid --repo: ${repoFullName}`);
  return { owner, repo };
}

async function githubRequest<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `GitHub request failed ${res.status} ${res.statusText}: ${detail.slice(
        0,
        500,
      )}`,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function findExistingComment(input: {
  token: string;
  owner: string;
  repo: string;
  issue: string;
}): Promise<GitHubComment | null> {
  for (let page = 1; ; page += 1) {
    const comments = await githubRequest<GitHubComment[]>(
      input.token,
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(
        input.repo,
      )}/issues/${encodeURIComponent(input.issue)}/comments?per_page=100&page=${page}`,
    );
    const match = comments.find(
      (comment) =>
        comment.user?.type === "Bot" &&
        typeof comment.body === "string" &&
        comment.body.includes(MARKER),
    );
    if (match) return match;
    if (comments.length < 100) return null;
  }
}

async function upsertComment(input: {
  token: string;
  owner: string;
  repo: string;
  issue: string;
  body: string;
}): Promise<{ action: "created" | "updated"; id: number; html_url?: string }> {
  const body = input.body.includes(MARKER)
    ? input.body
    : `${MARKER}\n${input.body}`;
  const existing = await findExistingComment(input);
  if (existing) {
    const updated = await githubRequest<GitHubComment>(
      input.token,
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(
        input.repo,
      )}/issues/comments/${existing.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      },
    );
    return { action: "updated", id: existing.id, html_url: updated.html_url };
  }

  const created = await githubRequest<GitHubComment>(
    input.token,
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(
      input.repo,
    )}/issues/${encodeURIComponent(input.issue)}/comments`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    },
  );
  return {
    action: "created",
    id: created.id,
    html_url: created.html_url,
  };
}

function parseRecapJson(): JsonObject {
  try {
    const parsed = JSON.parse(process.env.RECAP_JSON || "{}");
    return parsed && typeof parsed === "object" ? (parsed as JsonObject) : {};
  } catch {
    return {};
  }
}

function buildWorkflowComment(): string {
  const parsed = parseRecapJson();
  const summary =
    parsed.summary && typeof parsed.summary === "object"
      ? (parsed.summary as JsonObject)
      : {};
  const headShort = (process.env.HEAD_SHA || "").slice(0, 7);
  const aid =
    "_A visual recap is an aid, not a replacement for reviewing the diff._";

  const lines: string[] = [MARKER];

  if (parsed.suppressed) {
    lines.push("### Visual recap — not generated");
    lines.push("");
    lines.push(
      "The recap was **suppressed** because the diff contains content that matched a secret/credential pattern. No plan was published.",
    );
    lines.push("");
    lines.push(
      `Reason: \`${String(parsed.reason || "potential secret in diff")}\`. Updated for \`${headShort}\`.`,
    );
    lines.push("");
    lines.push(aid);
    return lines.join("\n");
  }

  if (process.env.GENERATE_OUTCOME !== "success" || !parsed.url) {
    lines.push("### Visual recap — generation failed");
    lines.push("");
    lines.push(
      "The visual recap could not be generated for this push. This is informational only and does **not** block the PR.",
    );
    if (parsed.error) {
      lines.push("");
      lines.push("```");
      lines.push(String(parsed.error).slice(0, 500));
      lines.push("```");
    }
    lines.push("");
    lines.push(`Updated for \`${headShort}\`.`);
    lines.push("");
    lines.push(aid);
    return lines.join("\n");
  }

  lines.push("### Visual recap — review at a higher altitude");
  lines.push("");
  lines.push(`**[Open the interactive recap](${String(parsed.url)})**`);
  lines.push("");

  const bits: string[] = [];
  if (typeof summary.files === "number") {
    bits.push(
      `**${summary.files}** files (+${summary.added ?? "?"} / -${
        summary.removed ?? "?"
      })`,
    );
  }
  if (summary.schemaFiles) {
    bits.push(`**${summary.schemaFiles}** schema/migration`);
  }
  if (summary.actionFiles) {
    bits.push(`**${summary.actionFiles}** action/route`);
  }
  if (bits.length) lines.push(bits.join(" · "));

  if (process.env.DIFF_HUGE === "true") {
    lines.push("");
    lines.push(
      "> Large diff — this recap is a **summarized** view (top files + schema/API deltas).",
    );
  }

  lines.push("");
  lines.push(`Updated for \`${headShort}\`. ${aid}`);
  if (parsed.planId) {
    lines.push("");
    lines.push(`<!-- plan-id: ${String(parsed.planId)} -->`);
  }
  return lines.join("\n");
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const token = stringArg(args, "token");
  const { owner, repo } = repoParts(stringArg(args, "repo"));
  const issue = stringArg(args, "issue");

  if (command === "find-plan-id") {
    const existing = await findExistingComment({ token, owner, repo, issue });
    const body = existing?.body ?? "";
    const match = body.match(/<!--\s*plan-id:\s*([^\s]+)\s*-->/);
    process.stdout.write(match ? match[1] : "");
    return;
  }

  if (command === "upsert-workflow-comment") {
    const result = await upsertComment({
      token,
      owner,
      repo,
      issue,
      body: buildWorkflowComment(),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  throw new Error(
    "Usage: visual-recap-comment.ts find-plan-id|upsert-workflow-comment --repo owner/name --issue n --token token",
  );
}

main().catch((error) => {
  process.stderr.write(`${error?.message ?? error}\n`);
  process.exit(1);
});
