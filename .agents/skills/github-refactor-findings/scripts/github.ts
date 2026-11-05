// Refactor findings as GitHub issues in the common config's repo. Each issue
// body carries three marked sections the scripts own and rewrite in place:
// the current plan, the plan versions seen, and the finding's JSON state.
// Everything outside the markers is left alone, so people can edit freely.
import { readFileSync } from "node:fs";

import {
  commonConfig,
  loadSkillConfig,
  run,
  ScriptError,
} from "../../fragility-common/lib/cli.ts";
import {
  type CreateInput,
  type Finding,
  type FindingProperty,
  type Inline,
  type Paragraph,
  runMarkerPattern,
  type Tracker,
} from "../../fragility-common/lib/findings.ts";

export interface GitHubFindingsConfig {
  label: string;
  sightingCooldownDays: number;
  maxNewTicketsPerRun: number;
}

export function loadGitHubConfig(): GitHubFindingsConfig {
  return loadSkillConfig<GitHubFindingsConfig>(import.meta.url);
}

const BODY_LIMIT = 65_000;
const PLAN_START = /<!-- fragility-plan:start name="([^"]+)" -->/;
const PLAN_SECTION =
  /<!-- fragility-plan:start name="[^"]+" -->[\s\S]*?<!-- fragility-plan:end -->/;
const PLANS = /<!-- fragility-plans (\[[\s\S]*?\]) -->/;
const PROPERTY = /<!-- fragility-finding (\{[\s\S]*?\}) -->/;

interface RawIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  state_reason: string | null;
  created_at: string;
  updated_at: string;
  body: string | null;
  html_url: string;
}

export function parseIssueKey(raw: string, repo = commonConfig().repo): string {
  const text = raw.trim();
  const url = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)\/?$/.exec(
    text,
  );
  if (url) {
    if (url[1]?.toLowerCase() !== repo.toLowerCase())
      throw new ScriptError(`${raw} is not an issue in ${repo}`);
    return `#${url[2]}`;
  }
  const n = /^#?(\d+)$/.exec(text)?.[1];
  if (!n) throw new ScriptError(`${raw} is not an issue number or URL`);
  return `#${n}`;
}

/** The parsers take the first marker, so no text we write may be able to spell one. */
function neutral(text: string): string {
  return text.replace(/<!--\s*fragility-/g, "&lt;!-- fragility-");
}

/** `gh api` with exit 2 for auth and network failures, which mean the step could not run. */
export function gh(args: string[], input?: unknown): string {
  try {
    return run(
      "gh",
      ["api", ...args, ...(input === undefined ? [] : ["--input", "-"])],
      {
        timeoutMs: 120_000,
        input: input === undefined ? undefined : JSON.stringify(input),
      },
    );
  } catch (error) {
    const message = (error as Error).message;
    if (
      error instanceof ScriptError &&
      error.exitCode === 1 &&
      /HTTP 40[13]|gh auth login|Could not resolve|connection|timed out/i.test(
        message,
      )
    ) {
      throw new ScriptError(message, 2);
    }
    throw error;
  }
}

// An HTML comment ends at the first "-->", so JSON inside one must not contain it.
function hidden(name: string, value: unknown): string {
  return `<!-- ${name} ${JSON.stringify(value).replace(/-->/g, "--\\u003e")} -->`;
}

function markdown(paragraph: Inline[]): string {
  return paragraph
    .map((i) =>
      i.code
        ? `\`${i.text}\``
        : i.href
          ? `[${i.text.replace(/[[\]]/g, "\\$&")}](${i.href})`
          : i.text,
    )
    .join("")
    .trim();
}

function replaceOrAppend(body: string, pattern: RegExp, section: string) {
  return pattern.test(body)
    ? body.replace(pattern, () => section)
    : `${body.trimEnd()}\n\n${section}`;
}

export class GitHubIssues implements Tracker {
  readonly name = "GitHub";
  readonly repo: string;

  constructor(readonly config: GitHubFindingsConfig = loadGitHubConfig()) {
    this.repo = commonConfig().repo;
  }

  get label(): string {
    return this.config.label;
  }

  get sightingCooldownDays(): number {
    return this.config.sightingCooldownDays;
  }

  get maxNewTicketsPerRun(): number {
    return this.config.maxNewTicketsPerRun;
  }

  ticketUrl(key: string): string {
    return `https://github.com/${this.repo}/issues/${this.number(key)}`;
  }

  parseKey(raw: string): string {
    return parseIssueKey(raw);
  }

  private number(key: string): string {
    return key.replace(/^#/, "");
  }

  private issue(key: string): RawIssue {
    return JSON.parse(
      gh([`repos/${this.repo}/issues/${this.number(key)}`]),
    ) as RawIssue;
  }

  private setBody(key: string, body: string): void {
    gh(
      [
        "--method",
        "PATCH",
        `repos/${this.repo}/issues/${this.number(key)}`,
        "--silent",
      ],
      { body },
    );
  }

  async findings(): Promise<Finding[]> {
    const out = gh([
      "--paginate",
      `repos/${this.repo}/issues?labels=${encodeURIComponent(this.label)}&state=all&per_page=100`,
      "--jq",
      ".[] | select(.pull_request | not)",
    ]);
    return out
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => this.toFinding(JSON.parse(line) as RawIssue))
      .sort((a, b) => b.created.localeCompare(a.created));
  }

  private toFinding(issue: RawIssue): Finding {
    const body = issue.body ?? "";
    const property = parseProperty(body);
    const declined =
      issue.state === "closed" &&
      (issue.state_reason === "not_planned" ||
        issue.state_reason === "duplicate");
    return {
      key: `#${issue.number}`,
      url: issue.html_url,
      summary: issue.title,
      status:
        issue.state === "open"
          ? "open"
          : `closed (${issue.state_reason ?? "completed"})`,
      open: issue.state === "open",
      declined,
      resolution:
        issue.state === "closed" ? (issue.state_reason ?? "completed") : null,
      created: issue.created_at,
      updated: issue.updated_at,
      fingerprint:
        property?.fingerprint ??
        /Fingerprint:\s*`?(fsys:[^\s`]+)/.exec(body)?.[1] ??
        null,
      systems: property?.systems ?? [],
      paths: property?.paths ?? [],
      sightings: property?.sightings ?? [],
      sightingCount:
        property?.sightingCount ?? property?.sightings?.length ?? 0,
      firstSeen: property?.firstSeen ?? null,
      plans: parsePlans(body),
      lastCommented: property?.lastCommented ?? null,
      recurrenceOf: property?.recurrenceOf ?? recurrenceIn(body),
    };
  }

  // The plan goes in with the create: the factory implements open issues, and
  // must never see one before its plan is there.
  async create({
    meta,
    facts,
    planFile,
    planName,
  }: CreateInput): Promise<string> {
    const head = neutral(
      [meta.summary, facts.map((f) => `- ${markdown(f)}`).join("\n")].join(
        "\n\n",
      ),
    );
    const body = withPlan(head, readFileSync(planFile, "utf8"), planName);
    const created = JSON.parse(
      gh(["--method", "POST", `repos/${this.repo}/issues`], {
        title: `[${meta.area}] Refactor: ${meta.title}`.slice(0, 250),
        body,
        labels: [this.label],
      }),
    ) as { number?: number };
    if (!created.number)
      throw new ScriptError("GitHub issue create returned no number");
    return `#${created.number}`;
  }

  async currentProperty(key: string): Promise<FindingProperty | null> {
    return parseProperty(this.issue(key).body ?? "");
  }

  async setProperty(key: string, value: FindingProperty): Promise<void> {
    const body = this.issue(key).body ?? "";
    this.setBody(
      key,
      replaceOrAppend(body, PROPERTY, hidden("fragility-finding", value)),
    );
  }

  async attachPlan(key: string, file: string, planName: string): Promise<void> {
    const body = this.issue(key).body ?? "";
    this.setBody(key, withPlan(body, readFileSync(file, "utf8"), planName));
  }

  async ensureRecurrenceLink(key: string, recurrenceOf: string): Promise<void> {
    const n = this.number(recurrenceOf);
    const body = this.issue(key).body ?? "";
    if (new RegExp(`#${n}\\b|/issues/${n}\\b`).test(body)) return;
    gh(
      [
        "--method",
        "POST",
        `repos/${this.repo}/issues/${this.number(key)}/comments`,
        "--silent",
      ],
      { body: `Recurrence of #${n}.` },
    );
  }

  async hasRunComment(key: string, runId: string): Promise<boolean> {
    const marker = runMarkerPattern(runId);
    const out = gh([
      "--paginate",
      `repos/${this.repo}/issues/${this.number(key)}/comments?per_page=100`,
      "--jq",
      ".[].body",
    ]);
    return marker.test(out);
  }

  async comment(key: string, paragraphs: Paragraph[]): Promise<void> {
    gh(
      [
        "--method",
        "POST",
        `repos/${this.repo}/issues/${this.number(key)}/comments`,
        "--silent",
      ],
      { body: paragraphs.map(markdown).join("\n\n") },
    );
  }
}

function parseProperty(body: string): FindingProperty | null {
  const raw = PROPERTY.exec(body)?.[1];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FindingProperty;
  } catch {
    throw new ScriptError(
      "an issue's fragility-finding block is not valid JSON; fix or remove it by hand",
    );
  }
}

function recurrenceIn(body: string): string | null {
  const n = /Recurrence of \[?#(\d+)/.exec(body)?.[1];
  return n ? `#${n}` : null;
}

function parsePlans(body: string): string[] {
  const raw = PLANS.exec(body)?.[1];
  const listed = raw ? (JSON.parse(raw) as string[]) : [];
  const current = PLAN_START.exec(body)?.[1];
  return current && !listed.includes(current) ? [...listed, current] : listed;
}

/** Puts `plan` in the body as the current plan and records its name. */
function withPlan(body: string, plan: string, planName: string): string {
  plan = neutral(plan.replace(/^---\n[\s\S]*?\n---\n?/, ""));
  const plans = [...new Set([...parsePlans(body), planName])];
  const withList = replaceOrAppend(
    body,
    PLANS,
    hidden("fragility-plans", plans),
  );
  const room =
    BODY_LIMIT -
    withList.replace(PLAN_SECTION, "").length -
    planName.length -
    // The finding-state block is added after the plan and grows with sightings.
    5_000;
  const fitted =
    plan.length > room
      ? `${plan.slice(0, Math.max(0, room))}\n\n…(plan truncated to fit the issue body)`
      : plan;
  const section = [
    `<!-- fragility-plan:start name="${planName}" -->`,
    "## Plan",
    "",
    fitted.trim(),
    "<!-- fragility-plan:end -->",
  ].join("\n");
  // The plan goes above the hidden blocks so it reads right after the facts.
  if (PLAN_SECTION.test(withList))
    return withList.replace(PLAN_SECTION, () => section);
  const firstHidden = withList.search(/<!-- fragility-(plans|finding) /);
  return firstHidden === -1
    ? `${withList.trimEnd()}\n\n${section}`
    : `${withList.slice(0, firstHidden).trimEnd()}\n\n${section}\n\n${withList.slice(firstHidden)}`;
}
