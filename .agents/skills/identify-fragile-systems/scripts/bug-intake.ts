// Starts a bug-report run: fetches the report from GitHub or Jira (or takes a
// file or pasted text) and writes bug.json, which switches the rest of the
// pipeline into bug mode for that run.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { adfText, Jira } from "./jira.ts";
import {
  argString,
  type Config,
  loadConfig,
  main,
  readJson,
  rel,
  run,
  runDir,
  runId,
  ScriptError,
  writeJson,
} from "./lib.ts";

export interface BugReport {
  runId: string;
  source: {
    kind: "github-issue" | "github-pr" | "jira" | "file" | "text";
    ref: string;
    url: string | null;
  };
  title: string;
  body: string;
  comments: { author: string; body: string }[];
  reportedAt: string | null;
  intakeAt: string;
}

type Intake = Omit<BugReport, "runId" | "intakeAt">;

const BODY_LIMIT = 20_000;
const COMMENT_LIMIT = 2_000;
const MAX_COMMENTS = 15;

main(async (args) => {
  const issue = argString(args, "issue");
  const jiraKey = argString(args, "jira");
  const file = argString(args, "file");
  const text = argString(args, "text");
  const given = [issue, jiraKey, file, text].filter(Boolean).length;
  if (args.help || given !== 1) {
    console.log(
      'bug-intake (--issue <N|github url> | --jira <KEY|jira url> | --file <path> | --text "<report>") [--title "<line>"] [--run <id>] [--force]',
    );
    if (!args.help) process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const intake = issue
    ? fromGitHub(config, issue)
    : jiraKey
      ? await fromJira(config, jiraKey)
      : fromText(file ? readFile(file) : text!, file);
  if (!`${intake.title}${intake.body}`.trim())
    throw new ScriptError("the bug report is empty");
  const title =
    argString(args, "title") ?? (intake.title.trim() || "Untitled bug report");

  const id = runId({
    ...args,
    run: argString(args, "run") ?? defaultRun(intake),
  });
  const out = path.join(runDir(config, id), "bug.json");
  if (existsSync(out) && !args.force) {
    const existing = readJson<BugReport>(out);
    if (existing.source.ref !== intake.source.ref) {
      throw new ScriptError(
        `${rel(out)} already holds ${existing.source.ref}; pass a different --run or --force`,
      );
    }
  }
  const report: BugReport = {
    runId: id,
    ...intake,
    title,
    intakeAt: new Date().toISOString(),
  };
  writeJson(out, report);

  console.log(`run ${id}: ${rel(out)}`);
  console.log(
    `source: ${report.source.kind} ${report.source.url ?? report.source.ref}`,
  );
  console.log(`title: ${report.title}`);
  console.log("");
  console.log(report.body.split("\n").slice(0, 60).join("\n"));
  if (report.comments.length)
    console.log(`\n(${report.comments.length} comments in bug.json)`);
});

function defaultRun(intake: Intake): string {
  const { kind, ref } = intake.source;
  if (kind === "github-issue" || kind === "github-pr")
    return `bug-gh-${ref.split("#").pop()}`;
  if (kind === "jira") return `bug-${ref.toLowerCase()}`;
  const hash = createHash("sha1").update(intake.body).digest("hex").slice(0, 8);
  return `bug-${new Date().toISOString().slice(0, 10)}-${hash}`;
}

function fromGitHub(config: Config, ref: string): Intake {
  const url = /github\.com\/([\w.-]+\/[\w.-]+)\/(issues|pull)\/(\d+)/.exec(ref);
  if (!url && !/^#?\d+$/.test(ref))
    throw new ScriptError(`--issue must be a number or a GitHub issue/PR URL`);
  const repo = url?.[1] ?? config.repo;
  const number = url?.[3] ?? ref.replace("#", "");
  const kind = url?.[2] === "pull" ? "github-pr" : "github-issue";
  const raw = run(
    "gh",
    [
      kind === "github-pr" ? "pr" : "issue",
      "view",
      number,
      "--repo",
      repo,
      "--json",
      "number,title,body,url,createdAt,comments",
    ],
    { timeoutMs: 60_000 },
  );
  const data = JSON.parse(raw) as {
    title: string;
    body: string;
    url: string;
    createdAt: string;
    comments: { author: { login: string } | null; body: string }[];
  };
  return {
    source: { kind, ref: `${repo}#${number}`, url: data.url },
    title: data.title,
    body: data.body.slice(0, BODY_LIMIT),
    comments: data.comments.slice(-MAX_COMMENTS).map((c) => ({
      author: c.author?.login ?? "unknown",
      body: c.body.slice(0, COMMENT_LIMIT),
    })),
    reportedAt: data.createdAt,
  };
}

async function fromJira(config: Config, ref: string): Promise<Intake> {
  const key = (/\b([A-Z][A-Z0-9]+-\d+)\b/.exec(ref) ?? [])[1];
  if (!key) throw new ScriptError(`--jira must be an issue key or URL`);
  const jira = new Jira(config);
  const issue = await jira.request<{
    fields: {
      summary: string;
      description: unknown;
      created: string;
      comment?: {
        comments: { author?: { displayName?: string }; body: unknown }[];
      };
    };
  }>(
    "GET",
    `/rest/api/3/issue/${key}?fields=summary,description,created,comment`,
    undefined,
    { allow404: true },
  );
  if (!issue) throw new ScriptError(`${key} not found or not visible`);
  return {
    source: { kind: "jira", ref: key, url: jira.browseUrl(key) },
    title: issue.fields.summary,
    body: adfText(issue.fields.description).slice(0, BODY_LIMIT),
    comments: (issue.fields.comment?.comments ?? [])
      .slice(-MAX_COMMENTS)
      .map((c) => ({
        author: c.author?.displayName ?? "unknown",
        body: adfText(c.body).slice(0, COMMENT_LIMIT),
      })),
    reportedAt: issue.fields.created,
  };
}

function fromText(body: string, file: string | undefined): Intake {
  const firstLine = body.trim().split("\n")[0] ?? "";
  return {
    source: {
      kind: file ? "file" : "text",
      ref: file ? path.basename(file) : "pasted report",
      url: null,
    },
    title: firstLine.replace(/^#+\s*/, "").slice(0, 120),
    body: body.slice(0, BODY_LIMIT),
    comments: [],
    reportedAt: null,
  };
}

function readFile(file: string): string {
  const resolved = path.resolve(file);
  if (!existsSync(resolved)) throw new ScriptError(`${file} does not exist`);
  return readFileSync(resolved, "utf8");
}
