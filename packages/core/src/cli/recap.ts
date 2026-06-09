/**
 * `agent-native recap <scan|build-prompt|shot|comment>` — the helper surface
 * used by the PR Visual Recap GitHub Action.
 *
 * The action no longer generates the recap deterministically. Instead a coding
 * agent (Claude Code or Codex) RUNS THE REPO'S visual-recap skill against the
 * diff and publishes the plan via the plan MCP tools. These subcommands are the
 * thin, deterministic glue around that:
 *
 *   scan          Refuse to hand a secret-leaking diff to the agent.
 *   build-prompt  Assemble the agent prompt = repo SKILL.md + a task wrapper.
 *   shot          Screenshot the published plan and upload it to the plan app's
 *                 signed public image route (for an inline PR-comment image).
 *   comment       Find the previous plan id / upsert the sticky PR comment.
 *
 * Promoting these to the published CLI means an installed repo's workflow calls
 * `agent-native recap …` instead of copying helper scripts into the repo.
 *
 * Node built-ins only (plus an optional dynamic `playwright` import for `shot`).
 */

import fs from "node:fs";
import path from "node:path";

import { PR_VISUAL_RECAP_WORKFLOW_YML } from "./pr-visual-recap-workflow.js";

/* -------------------------------------------------------------------------- */
/* Arg parsing                                                                */
/* -------------------------------------------------------------------------- */

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

function optionalArg(
  args: Record<string, string | boolean>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/* -------------------------------------------------------------------------- */
/* GitHub Action install (used by `skills add … --with-github-action`)        */
/* -------------------------------------------------------------------------- */

/** GitHub secrets the installed PR Visual Recap workflow needs. */
export const PR_VISUAL_RECAP_SETUP: string[] = [
  "Required secrets:",
  "  PLAN_RECAP_TOKEN   — bearer token from `agent-native connect`",
  "  ANTHROPIC_API_KEY  — the LLM key for the default Claude Code backend",
  "Optional (only if you change defaults):",
  "  OPENAI_API_KEY (secret) + VISUAL_RECAP_AGENT=codex (variable) — use Codex instead of Claude",
  "  VISUAL_RECAP_MODEL / VISUAL_RECAP_REASONING (variables) — pin the model (e.g. gpt-5.5) and reasoning depth (none|minimal|low|medium|high|xhigh; Codex only)",
  "  PLAN_RECAP_APP_URL (secret) — only when self-hosting the plan app (defaults to https://plan.agent-native.com)",
];

/** Write .github/workflows/pr-visual-recap.yml into a repo. */
export function writePrVisualRecapWorkflow(baseDir: string): {
  path: string;
  existed: boolean;
} {
  const dir = path.resolve(baseDir, ".github", "workflows");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "pr-visual-recap.yml");
  const existed = fs.existsSync(file);
  fs.writeFileSync(file, PR_VISUAL_RECAP_WORKFLOW_YML);
  return { path: path.relative(baseDir, file), existed };
}

/* -------------------------------------------------------------------------- */
/* Secret scan — defense-in-depth before any LLM sees the diff                */
/* -------------------------------------------------------------------------- */

/**
 * If the diff contains anything that looks like a real secret, we refuse to
 * build a recap at all (rather than risk echoing it into a published plan).
 * These patterns intentionally err toward caution and scan added, removed, and
 * context lines so deleting a real secret does not leak it in a split diff.
 */
const SECRET_PATTERNS: RegExp[] = [
  // Common provider key prefixes.
  /\b(?:sk|pk|rk)-[A-Za-z0-9]{16,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  // Bearer / Authorization header values with an actual token.
  /authorization\s*[:=]\s*['"]?bearer\s+[A-Za-z0-9._-]{12,}/i,
  // Private key blocks.
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  // `KEY=...`, `TOKEN=...`, `SECRET=...`, `PASSWORD=...` assigned a real-looking
  // value (long, non-placeholder).
  /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\s*[:=]\s*['"]?(?!.*(?:your|example|placeholder|changeme|xxxx|\*\*\*|<|\$\{|process\.env|env\.|REDACTED))[A-Za-z0-9/_+=.-]{16,}/i,
];

export function lineLooksSecret(line: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(line));
}

export function diffContainsSecret(diffText: string): boolean {
  for (const line of diffText.split("\n")) {
    if (
      line.startsWith("+") ||
      line.startsWith("-") ||
      line.startsWith(" ") ||
      line.startsWith("+++") ||
      line.startsWith("---")
    ) {
      if (lineLooksSecret(line)) return true;
    }
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Prompt builder — repo SKILL.md + task wrapper                              */
/* -------------------------------------------------------------------------- */

/**
 * Locate the repo's visual-recap SKILL.md, preferring the host-agent install
 * locations so a user's `agent-native skills add` copy wins, then falling back
 * to the framework's own source locations.
 */
export function readRepoSkillMd(cwd: string = process.cwd()): {
  text: string;
  source: string;
} {
  const candidates = [
    ".claude/skills/visual-recap/SKILL.md",
    ".agents/skills/visual-recap/SKILL.md",
    "skills/visual-recap/SKILL.md",
    "templates/plan/.agents/skills/visual-recap/SKILL.md",
  ];
  for (const rel of candidates) {
    const abs = path.resolve(cwd, rel);
    if (fs.existsSync(abs)) {
      return { text: fs.readFileSync(abs, "utf8"), source: rel };
    }
  }
  throw new Error(
    "Could not find visual-recap/SKILL.md. Run `agent-native skills add visual-plan` first.",
  );
}

export function buildRecapPrompt(input: {
  skillMd: string;
  pr: string;
  head?: string;
  appUrl: string;
  diffPath: string;
  statPath?: string;
  prevPlanId?: string;
  huge?: boolean;
}): string {
  const appUrl = input.appUrl.replace(/\/$/, "");
  const lines: string[] = [];
  lines.push("# Task: publish a Visual Recap of this pull request");
  lines.push("");
  lines.push(
    `You are running non-interactively in CI. Follow the **visual-recap skill** included verbatim below to turn this PR's diff into a grounded Agent-Native Plan, then publish it.`,
  );
  lines.push("");
  lines.push("## Inputs (read them from disk with your Read tool)");
  lines.push(`- PR number: **#${input.pr}**`);
  if (input.head) lines.push(`- Head commit: \`${input.head}\``);
  lines.push(`- Unified diff: \`${input.diffPath}\` (read this file)`);
  if (input.statPath)
    lines.push(`- Diff stat: \`${input.statPath}\` (read this file)`);
  if (input.huge) {
    lines.push(
      `- The diff is LARGE — produce a **summarized** recap (top files + schema/API deltas), not an exhaustive one.`,
    );
  }
  lines.push("");
  lines.push("## Publish (this is the only way to produce output)");
  lines.push(
    `The \`plan\` MCP server is configured for you. Call its tools by name (your host may expose them as \`create-visual-recap\` or \`mcp__plan__create-visual-recap\` — same tool).`,
  );
  lines.push(
    `1. Call the **create-visual-recap** tool on the \`plan\` MCP server with grounded MDX derived ONLY from the real diff${
      input.prevPlanId
        ? `, passing \`planId: "${input.prevPlanId}"\` so this REPLACES the existing recap plan`
        : ""
    }.`,
  );
  lines.push(
    `2. Call the **set-resource-visibility** tool on the \`plan\` MCP server with \`{ resourceType: "plan", resourceId: <the returned plan id>, visibility: "org" }\` so the recap is login-gated to the org, never public.`,
  );
  lines.push(
    `3. Write the plan URL to a file named \`recap-url.txt\` at the repo root, containing exactly one line: \`${appUrl}/recaps/<the returned plan id>\`. This file is the workflow's only hand-off — do not print anything else as the deliverable.`,
  );
  lines.push("");
  lines.push(
    "Do not invent file names, schema fields, or endpoints. Redact anything that looks like a secret. If the diff has no reviewable substance, still publish a minimal recap and write recap-url.txt.",
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("# visual-recap skill (follow this exactly)");
  lines.push("");
  lines.push(input.skillMd.trim());
  lines.push("");
  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* GitHub comment helpers                                                     */
/* -------------------------------------------------------------------------- */

const MARKER = "<!-- pr-visual-recap -->";

type GitHubComment = {
  id: number;
  body?: string | null;
  html_url?: string;
  user?: { type?: string | null } | null;
};

function repoParts(repoFullName: string): { owner: string; repo: string } {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) throw new Error(`Invalid --repo: ${repoFullName}`);
  return { owner, repo };
}

async function githubRequest<T>(
  token: string,
  apiPath: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`https://api.github.com${apiPath}`, {
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
      `GitHub request failed ${res.status} ${res.statusText}: ${detail.slice(0, 500)}`,
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
  /** When true, refresh an existing comment but never create a new one. */
  updateOnly?: boolean;
}): Promise<{
  action: "created" | "updated" | "skipped";
  id: number;
  html_url?: string;
}> {
  const body = input.body.includes(MARKER)
    ? input.body
    : `${MARKER}\n${input.body}`;
  const existing = await findExistingComment(input);
  if (!existing && input.updateOnly) {
    // Nothing to refresh and we were told not to create — e.g. a tiny diff with
    // no prior recap. Stay silent rather than posting a "skipped" comment.
    return { action: "skipped", id: 0 };
  }
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
  return { action: "created", id: created.id, html_url: created.html_url };
}

function planIdFromUrl(url: string): string | null {
  // Accept both /recaps/<id> (the canonical recap route the agent now writes)
  // and /plans/<id> (legacy URLs) so the sticky-comment rebuild keeps working.
  const match = url.match(/\/(?:recaps|plans)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

/** True when both URLs parse and share an origin. */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** The origin of a URL, or "" if it doesn't parse. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/** Build the sticky comment body from the workflow's environment. */
export function buildCommentBody(env: NodeJS.ProcessEnv = process.env): string {
  const headShort = (env.HEAD_SHA || "").slice(0, 7);
  const lines: string[] = [MARKER];

  if (env.SUPPRESSED === "true") {
    let reason = "potential secret in diff";
    try {
      const parsed = JSON.parse(env.SUPPRESSED_JSON || "{}");
      if (parsed && typeof parsed.reason === "string") reason = parsed.reason;
    } catch {
      /* keep default */
    }
    lines.push("### Visual recap — not generated");
    lines.push("");
    lines.push(
      "The recap was **suppressed** because the diff matched a secret/credential pattern. No plan was published.",
    );
    lines.push("");
    lines.push(`Reason: \`${reason}\`. Updated for \`${headShort}\`.`);
    return lines.join("\n");
  }

  // Tiny diffs aren't worth a recap. Refresh an existing sticky comment to this
  // state (the workflow only updates, never creates, on tiny) so it never lingers
  // pointing at a stale head SHA.
  if (env.DIFF_TINY === "true") {
    lines.push("### Visual recap — skipped (diff too small)");
    lines.push("");
    lines.push(
      "The change in this push is too small to be worth a visual recap. This is informational only and does **not** block the PR.",
    );
    lines.push("");
    lines.push(`Updated for \`${headShort}\`.`);
    return lines.join("\n");
  }

  const planUrl = (env.PLAN_URL || "").trim();
  const appUrl = (env.PLAN_RECAP_APP_URL || "").trim();
  // recap-url.txt is agent-written → untrusted. Rebuild a canonical link from a
  // TRUSTED base (the configured PLAN_RECAP_APP_URL when set, else the parsed
  // origin of the plan URL) plus a strictly-validated plan id, instead of
  // embedding the raw URL. That both enforces the app origin and prevents
  // markdown injection — a same-origin URL with a crafted path/query could
  // otherwise break out of the markdown link.
  const planId = planUrl ? planIdFromUrl(planUrl) : null;
  const sameOriginOk = appUrl === "" || sameOrigin(planUrl, appUrl);
  const base = (appUrl || originOf(planUrl)).replace(/\/$/, "");
  const safeUrl =
    planId && base && sameOriginOk ? `${base}/recaps/${planId}` : "";
  if (!safeUrl) {
    lines.push("### Visual recap — generation failed");
    lines.push("");
    lines.push(
      "The visual recap could not be generated for this push. This is informational only and does **not** block the PR.",
    );
    lines.push("");
    lines.push(`Updated for \`${headShort}\`.`);
    return lines.join("\n");
  }

  // The image URL is produced by our own recap-image route, but validate it is
  // same-origin and matches the canonical hex-token path before embedding it, so
  // it likewise cannot inject markdown.
  const imageUrlRaw = (env.RECAP_IMAGE_URL || "").trim();
  const imageUrl =
    imageUrlRaw &&
    sameOrigin(imageUrlRaw, base) &&
    /\/_agent-native\/recap-image\/[0-9a-f]+\.png$/.test(imageUrlRaw)
      ? imageUrlRaw
      : "";
  lines.push("### Visual recap — review at a higher altitude");
  lines.push("");
  if (imageUrl) {
    lines.push(`[![Visual recap](${imageUrl})](${safeUrl})`);
    lines.push("");
  }
  lines.push(`**[Open the interactive recap](${safeUrl})**`);
  if (env.DIFF_HUGE === "true") {
    lines.push("");
    lines.push(
      "> Large diff — this recap is a **summarized** view (top files + schema/API deltas).",
    );
  }
  lines.push("");
  lines.push(`Updated for \`${headShort}\`.`);
  lines.push("");
  lines.push(`<!-- plan-id: ${planId} -->`);
  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Subcommands                                                                */
/* -------------------------------------------------------------------------- */

function runScan(args: Record<string, string | boolean>): void {
  const diffPath = stringArg(args, "diff");
  const diffText = fs.readFileSync(path.resolve(diffPath), "utf8");
  if (diffContainsSecret(diffText)) {
    process.stdout.write(
      `${JSON.stringify({ suppressed: true, reason: "potential secret in diff" })}\n`,
    );
  } else {
    process.stdout.write(`${JSON.stringify({ suppressed: false })}\n`);
  }
}

function runBuildPrompt(args: Record<string, string | boolean>): void {
  const skill = readRepoSkillMd();
  const prompt = buildRecapPrompt({
    skillMd: skill.text,
    pr: stringArg(args, "pr"),
    head: optionalArg(args, "head"),
    appUrl: optionalArg(args, "app-url") ?? "https://plan.agent-native.com",
    diffPath: optionalArg(args, "diff") ?? "recap.diff",
    statPath: optionalArg(args, "stat"),
    prevPlanId: optionalArg(args, "prev-plan-id"),
    huge: args.huge === true || args.huge === "true",
  });
  const out = optionalArg(args, "out") ?? "recap-prompt.md";
  fs.writeFileSync(path.resolve(out), prompt);
  process.stdout.write(
    `${JSON.stringify({ ok: true, out, skillSource: skill.source, bytes: prompt.length })}\n`,
  );
}

/** Upload a PNG to the plan app's signed public image route; returns its URL. */
async function uploadRecapImage(input: {
  appUrl: string;
  token: string;
  pngPath: string;
}): Promise<string | null> {
  try {
    const base = input.appUrl.replace(/\/$/, "");
    const bytes = fs.readFileSync(path.resolve(input.pngPath));
    const res = await fetch(`${base}/_agent-native/recap-image`, {
      method: "POST",
      headers: {
        "content-type": "image/png",
        authorization: `Bearer ${input.token}`,
      },
      body: bytes,
    });
    // Surface failures on stderr — stdout carries the machine-readable JSON the
    // workflow parses, so it must stay clean. A silent null here is exactly what
    // made the missing-inline-thumbnail failure undebuggable from CI logs.
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      process.stderr.write(
        `[recap shot] image upload failed: ${res.status} ${res.statusText} ${detail.slice(0, 300)}\n`,
      );
      return null;
    }
    const json = (await res.json().catch(() => null)) as {
      imageUrl?: string;
    } | null;
    if (!json?.imageUrl) {
      process.stderr.write(
        `[recap shot] image upload returned no imageUrl (status ${res.status})\n`,
      );
      return null;
    }
    return json.imageUrl;
  } catch (err) {
    process.stderr.write(`[recap shot] image upload error: ${String(err)}\n`);
    return null;
  }
}

async function runShot(args: Record<string, string | boolean>): Promise<void> {
  const url = stringArg(args, "url");
  const out = optionalArg(args, "out") ?? "recap.png";
  const token = optionalArg(args, "token");
  const appUrl = optionalArg(args, "app-url");

  const done = (obj: Record<string, unknown>) => {
    process.stdout.write(`${JSON.stringify(obj)}\n`);
  };

  // recap-url.txt is produced by the (LLM) agent, so the URL is untrusted. Only
  // forward the reusable publish token to the trusted plan-app origin — never to
  // an arbitrary URL — so a poisoned recap-url.txt can't exfiltrate the bearer
  // to an attacker-controlled domain.
  let attachToken = false;
  if (token) {
    try {
      attachToken = !!appUrl && new URL(url).origin === new URL(appUrl).origin;
    } catch {
      attachToken = false;
    }
    if (!attachToken) {
      done({
        ok: false,
        reason: appUrl
          ? `refusing to screenshot ${url}: origin does not match --app-url (${appUrl}); the publish token is only sent to the trusted plan app origin`
          : `refusing to attach the publish token without --app-url to validate ${url} against`,
      });
      return;
    }
  }

  let chromium: typeof import("playwright").chromium | undefined;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    try {
      ({ chromium } =
        (await import("@playwright/test")) as unknown as typeof import("playwright"));
    } catch (err) {
      done({ ok: false, reason: `playwright not available: ${String(err)}` });
      return;
    }
  }

  let captured = false;
  let browser: import("playwright").Browser | undefined;
  const hardTimer = setTimeout(() => {
    done({ ok: false, reason: "hard 60s timeout reached" });
    process.exit(0);
  }, 60_000);
  try {
    browser = await chromium!.launch({ args: ["--no-sandbox"] });
    const context = await browser.newContext({
      viewport: { width: 1450, height: 1450 },
      deviceScaleFactor: 2,
    });
    if (attachToken) {
      // Attach the bearer ONLY to same-origin requests. Context-wide
      // extraHTTPHeaders would also send it to every cross-origin subresource
      // the plan page loads (CDN images/fonts/scripts), leaking the publish
      // token; routing scopes it to the trusted app origin.
      const appOrigin = new URL(appUrl as string).origin;
      await context.route("**/*", async (route) => {
        const request = route.request();
        if (new URL(request.url()).origin === appOrigin) {
          await route.continue({
            headers: { ...request.headers(), authorization: `Bearer ${token}` },
          });
        } else {
          await route.continue();
        }
      });
    }
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    const selectors = [
      "[data-plan-document]",
      "[data-plan-block]",
      "main article",
      "[data-testid='plan-document']",
      "main",
    ];
    let matched = false;
    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 6_000, state: "visible" });
        matched = true;
        break;
      } catch {
        /* try the next selector */
      }
    }
    await page.waitForTimeout(matched ? 1_200 : 500);
    // Zoom out slightly so more content fits. Keep the plan title (h1) in frame:
    // the recap reads better led by its own title than cropped to the body.
    await page.evaluate(() => {
      (document.documentElement as HTMLElement).style.zoom = "80%";
    });
    await page.screenshot({ path: out });
    captured = true;
    await browser.close();
  } catch (err) {
    clearTimeout(hardTimer);
    try {
      if (browser) await browser.close();
    } catch {
      /* ignore */
    }
    done({
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  clearTimeout(hardTimer);

  let imageUrl: string | null = null;
  if (captured && token && appUrl) {
    imageUrl = await uploadRecapImage({ appUrl, token, pngPath: out });
  }
  done({ ok: captured, out, imageUrl });
}

async function runComment(
  args: Record<string, string | boolean>,
  sub: string,
): Promise<void> {
  const token = stringArg(args, "token");
  const { owner, repo } = repoParts(stringArg(args, "repo"));
  const issue = stringArg(args, "issue");

  if (sub === "find-plan-id") {
    const existing = await findExistingComment({ token, owner, repo, issue });
    const body = existing?.body ?? "";
    const match = body.match(/<!--\s*plan-id:\s*([^\s]+)\s*-->/);
    process.stdout.write(match ? match[1] : "");
    return;
  }

  if (sub === "upsert") {
    const result = await upsertComment({
      token,
      owner,
      repo,
      issue,
      body: buildCommentBody(),
      updateOnly:
        args["update-only"] === true || args["update-only"] === "true",
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  throw new Error(
    "Usage: agent-native recap comment <find-plan-id|upsert> --repo owner/name --issue n --token token",
  );
}

/* -------------------------------------------------------------------------- */
/* Usage capture — parse the agent's own token usage and attach it to the plan */
/* -------------------------------------------------------------------------- */

interface ParsedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model?: string;
  reportedCostUsd?: number;
}

/** Parse the last top-level JSON object from a possibly-noisy stdout dump. */
function parseLastJsonObject(text: string): Record<string, any> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to line-by-line */
  }
  const lines = trimmed.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      return JSON.parse(line);
    } catch {
      /* keep scanning earlier lines */
    }
  }
  return null;
}

/**
 * Claude Code `-p --output-format json` prints one final result object with a
 * `usage` block and `total_cost_usd`. Anthropic's `input_tokens` already
 * EXCLUDES cache tokens, so no normalization is needed here.
 */
export function parseClaudeUsage(stdout: string): ParsedUsage | null {
  const obj = parseLastJsonObject(stdout);
  const u = obj?.usage;
  if (!u) return null;
  const model =
    typeof obj?.model === "string"
      ? obj.model
      : obj?.modelUsage && typeof obj.modelUsage === "object"
        ? Object.keys(obj.modelUsage)[0]
        : undefined;
  return {
    inputTokens: Number(u.input_tokens ?? 0),
    outputTokens: Number(u.output_tokens ?? 0),
    cacheReadTokens: Number(u.cache_read_input_tokens ?? 0),
    cacheWriteTokens: Number(u.cache_creation_input_tokens ?? 0),
    model,
    reportedCostUsd:
      typeof obj?.total_cost_usd === "number" ? obj.total_cost_usd : undefined,
  };
}

/** Pull the last usage object out of a Codex `exec --json` JSONL stream. */
function lastCodexUsage(jsonl: string): Record<string, any> | undefined {
  let last: Record<string, any> | undefined;
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    // turn.completed carries `usage`; token_count events nest it under
    // `info.total_token_usage`. Accept whichever the pinned Codex emits.
    const u =
      obj?.usage ??
      obj?.turn?.usage ??
      obj?.msg?.usage ??
      obj?.info?.total_token_usage ??
      obj?.payload?.info?.total_token_usage;
    if (u && (u.input_tokens != null || u.total_tokens != null)) last = u;
  }
  return last;
}

/**
 * Codex `exec --json` reports `input_tokens` INCLUSIVE of `cached_input_tokens`
 * (OpenAI counts cached as a subset of prompt tokens) and bills
 * `reasoning_output_tokens` separately. Normalize to the cache-exclusive shape
 * `calculateCost` expects: strip cached out of input, fold reasoning into
 * output. Without this, cached tokens are billed twice and reasoning is dropped.
 */
export function parseCodexUsage(jsonl: string): ParsedUsage | null {
  const u = lastCodexUsage(jsonl);
  if (!u) return null;
  const cached = Number(u.cached_input_tokens ?? 0);
  const input = Number(u.input_tokens ?? 0) - cached;
  return {
    inputTokens: Math.max(0, input),
    outputTokens:
      Number(u.output_tokens ?? 0) + Number(u.reasoning_output_tokens ?? 0),
    cacheReadTokens: cached,
    cacheWriteTokens: 0, // Codex has no separate cache-write token charge
    model: typeof u.model === "string" ? u.model : undefined,
  };
}

/**
 * `recap usage` — parse the agent's run output for token usage and POST it to
 * the plan app's record-recap-usage action so the recap row carries cost. The
 * publish token is only ever sent to the trusted --app-url origin (the plan id
 * is parsed from the untrusted agent-written plan URL but never forwarded).
 */
async function runUsage(args: Record<string, string | boolean>): Promise<void> {
  const done = (obj: Record<string, unknown>) =>
    process.stdout.write(`${JSON.stringify(obj)}\n`);

  const planUrl = stringArg(args, "plan-url");
  const planId = planIdFromUrl(planUrl);
  const agent = (optionalArg(args, "agent") ?? "claude").toLowerCase();
  const appUrl = optionalArg(args, "app-url");
  const token = optionalArg(args, "token");

  if (!planId) {
    done({ ok: false, reason: `could not parse plan id from ${planUrl}` });
    return;
  }
  if (!appUrl || !token) {
    done({ ok: false, reason: "missing --app-url or --token" });
    return;
  }

  let parsed: ParsedUsage | null = null;
  try {
    const raw = fs.readFileSync(
      path.resolve(stringArg(args, "result-file")),
      "utf8",
    );
    parsed = agent === "codex" ? parseCodexUsage(raw) : parseClaudeUsage(raw);
  } catch (err) {
    done({ ok: false, reason: `could not read/parse usage: ${String(err)}` });
    return;
  }
  if (!parsed) {
    done({ ok: false, reason: "no usage found in agent output" });
    return;
  }

  // The Claude result carries the model; Codex usually does not, so fall back to
  // the pinned --model (VISUAL_RECAP_MODEL) and finally the documented default.
  const model =
    parsed.model ??
    optionalArg(args, "model") ??
    (agent === "codex" ? "gpt-5.5" : "claude");
  const body: Record<string, unknown> = {
    planId,
    ...(agent === "codex" || agent === "claude" ? { agent } : {}),
    model,
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
    cacheReadTokens: parsed.cacheReadTokens,
    cacheWriteTokens: parsed.cacheWriteTokens,
    ...(parsed.reportedCostUsd != null
      ? { reportedCostUsd: parsed.reportedCostUsd }
      : {}),
  };

  try {
    const base = appUrl.replace(/\/$/, "");
    const res = await fetch(
      `${base}/_agent-native/actions/record-recap-usage`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      done({
        ok: false,
        reason: `record-recap-usage failed ${res.status}: ${detail.slice(0, 300)}`,
      });
      return;
    }
    done({ ok: true, planId, ...body });
  } catch (err) {
    done({ ok: false, reason: `record-recap-usage error: ${String(err)}` });
  }
}

const HELP = `agent-native recap — PR visual recap helpers (used by the GitHub Action)

Usage:
  agent-native recap scan --diff <path>
  agent-native recap build-prompt --pr <n> [--head <sha>] [--app-url <url>] [--diff <path>] [--stat <path>] [--prev-plan-id <id>] [--huge] [--out <path>]
  agent-native recap shot --url <planUrl> [--token <planToken>] [--app-url <url>] [--out recap.png]
  agent-native recap usage --plan-url <planUrl> --result-file <path> --app-url <url> --token <planToken> [--agent claude|codex] [--model <id>]
  agent-native recap comment <find-plan-id|upsert> --repo owner/name --issue <n> --token <github-token>
`;

export async function runRecap(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  const args = parseArgs(rest);
  switch (sub) {
    case "scan":
      runScan(args);
      return;
    case "build-prompt":
      runBuildPrompt(args);
      return;
    case "shot":
      await runShot(args);
      return;
    case "usage":
      await runUsage(args);
      return;
    case "comment":
      await runComment(parseArgs(rest.slice(1)), rest[0] ?? "");
      return;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      process.stdout.write(HELP);
      return;
    default:
      process.stderr.write(`Unknown recap subcommand: ${sub}\n${HELP}`);
      process.exit(1);
  }
}
