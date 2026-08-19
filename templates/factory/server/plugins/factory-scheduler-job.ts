import { subscribe } from "@agent-native/core/event-bus";
import { notify } from "@agent-native/core/notifications";
import { resolveOrgIdForEmail } from "@agent-native/core/org";
import {
  organizationResourceOwner,
  resourceGetByPath,
  resourcePut,
  resourcePutIfCurrent,
  WORKSPACE_OWNER,
} from "@agent-native/core/resources";
import {
  defineNitroPlugin,
  runWithRequestContext,
} from "@agent-native/core/server";
import { and, eq, isNull, lt, ne, or } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { triageConfig } from "../db/schema.js";
import {
  syncManagedReviewSkillAlignment,
  type FactoryAutomationName,
} from "../triage/review-skill-alignment.js";

const LEGACY_JOB_PATH = "jobs/factory-observation-scheduler.md";
const DEFAULT_SLACK_CHANNEL_ID = "C0ATH3CCZT4";
const DEFAULT_SLACK_CHANNEL_NAME = "product-agent-native-feedback";
const FAILURE_ALERT_COOLDOWN_MS = 15 * 60_000;

type AutomationRunFinishedEvent = {
  automationRunId: string;
  owner: string;
  automation: string;
  path: string;
  orgId: string | null;
  runId: string | null;
  threadId: string | null;
  status: "success" | "error" | "interrupted";
  error: string | null;
};

let failureAlertSubscription: string | null = null;

function factoryPublicUrl(): string | undefined {
  const value = process.env.FACTORY_PUBLIC_URL?.trim(); // guard:allow-env-credential - public callback origin, not a credential
  if (!value || /[\r\n]/.test(value)) return undefined;
  return value.replace(/\/+$/, "");
}

async function notifyFactoryAutomationFailure(
  event: AutomationRunFinishedEvent,
): Promise<void> {
  if (
    (event.status !== "error" && event.status !== "interrupted") ||
    !event.orgId ||
    !event.path.startsWith("jobs/factory-")
  ) {
    return;
  }

  const db = getDb();
  const config = (
    await db
      .select({
        ownerEmail: triageConfig.ownerEmail,
        alertsEnabled: triageConfig.automationFailureAlertsEnabled,
        alertEmail: triageConfig.automationFailureAlertEmail,
      })
      .from(triageConfig)
      .where(
        and(
          eq(triageConfig.id, event.orgId),
          eq(triageConfig.orgId, event.orgId),
        ),
      )
      .limit(1)
  )[0];
  if (!config || config.alertsEnabled !== 1) return;

  const recipient = (config.alertEmail || config.ownerEmail || "")
    .trim()
    .toLowerCase();
  if (!recipient) return;

  const error =
    event.error ||
    "The automation ended without recording a terminal result. No delivery was confirmed.";
  const alertKey = `${event.automation}\n${error}`.slice(0, 700);
  const now = new Date();
  const cutoff = new Date(now.getTime() - FAILURE_ALERT_COOLDOWN_MS);
  const claimed = await db
    .update(triageConfig)
    .set({
      lastAutomationFailureAlertKey: alertKey,
      lastAutomationFailureAlertAt: now.toISOString(),
    })
    .where(
      and(
        eq(triageConfig.id, event.orgId),
        eq(triageConfig.orgId, event.orgId),
        eq(triageConfig.automationFailureAlertsEnabled, 1),
        or(
          isNull(triageConfig.lastAutomationFailureAlertKey),
          ne(triageConfig.lastAutomationFailureAlertKey, alertKey),
          isNull(triageConfig.lastAutomationFailureAlertAt),
          lt(triageConfig.lastAutomationFailureAlertAt, cutoff.toISOString()),
        ),
      ),
    )
    .returning({ id: triageConfig.id });
  if (claimed.length === 0) return;

  const url = factoryPublicUrl();
  const debugTarget = url
    ? `${url}/factory?tab=automations`
    : "Factory > Automations";
  const details = [
    `Automation: ${event.automation}`,
    `Run: ${event.automationRunId}`,
    `Error: ${error}`,
    `Debug: ${debugTarget}`,
    "Next steps: open Scheduler health, then open this run's thread and inspect the last error. If health is stale, inspect the deployed scheduled function and background worker.",
    event.threadId ? `Agent thread: ${event.threadId}` : "",
    event.runId ? `Agent run: ${event.runId}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  await runWithRequestContext(
    { userEmail: config.ownerEmail, orgId: event.orgId },
    () =>
      notify(
        {
          severity: "critical",
          title: `Factory automation failed: ${event.automation}`,
          body: details,
          metadata: {
            emailRecipients: [recipient],
            emailSubject: `Factory automation failed: ${event.automation}`,
            automationRunId: event.automationRunId,
          },
          channels: ["inbox", "email"],
        },
        { owner: config.ownerEmail },
      ),
  );
}

function subscribeToAutomationFailures(): void {
  if (failureAlertSubscription) return;
  failureAlertSubscription = subscribe("automation.run.finished", (payload) =>
    notifyFactoryAutomationFailure(payload as AutomationRunFinishedEvent).catch(
      (error) => {
        console.error(
          "[factory-scheduler-job] automation failure alert failed:",
          error,
        );
      },
    ),
  );
}

type AutomationSeed = {
  name: string;
  schedule: string;
  legacySchedules?: string[];
  timezone?: string;
  model: string;
  maxIterations: number;
  maxRunInputTokens: number;
  body: string;
};

const FACTORY_DEFAULT_MODEL =
  process.env.FACTORY_AUTOMATION_MODEL?.trim() || "gpt-5.6-luna";
const FACTORY_DEFAULT_MAX_ITERATIONS = 32;
const FACTORY_DEFAULT_MAX_RUN_INPUT_TOKENS = 1_000_000;
const SKIP_RECORD_GUARD =
  "After classifying each processed item, call start-builder-for-item with clearBug true or false and a short evidence-grounded reason so the skip or dispatch is recorded.";

const AUTOMATION_SEEDS: AutomationSeed[] = [
  {
    name: "factory-slack-feedback",
    schedule: "*/5 * * * *",
    legacySchedules: ["* * * * *"],
    model: FACTORY_DEFAULT_MODEL,
    maxIterations: FACTORY_DEFAULT_MAX_ITERATIONS,
    maxRunInputTokens: FACTORY_DEFAULT_MAX_RUN_INPUT_TOKENS,
    body: `
# Factory Slack feedback triage

Follow the repository's address-feedback, address-feedback-with-replies, and
review-latest-feedback skills for this workflow, and use review-prs when a PR
needs review. Read the Factory configuration. When Slack polling is enabled
and a channel is configured, call poll-slack-channel first. Then list at most 5
new or changed Slack items by passing needsReview true, source slack, and limit
5. Use one additional bounded recent Slack lookup with needsReview false,
source slack, and limit 20 only to find possible repeat reports; never list the
full queue or use an action's default page size.

Call get-slack-feedback-context for every new item and every possible repeat
that may belong to the same issue before classifying it. Read the full parent,
replies, reactions, and linked evidence. An unreadable or truncated thread is
not a clear bug and must stay manual. Search recent Slack history, local Git
history, merged PRs, and linked issues for repeats or an existing fix when
those sources are available.

Start work only for a clear bug: a concrete broken behavior, reproducible
failure, error, regression, stuck run, incorrect result, or a report with a
specific failing path and enough evidence to investigate. Do not treat feature
requests, wish-list ideas, broad UX suggestions, vague questions, or an
incomplete/truncated thread as clear bugs. The user's historical eyeball
reactions are calibration evidence, not an automatic authorization signal.
That history is strongest for concrete failures such as stuck or never-starting
runs, incorrect object/object output, disk-full or database-locked errors,
stale loops, broken uploads or duplicate imports, missing scaffolding or docs,
and concrete auth or configuration failures. Use those examples to recognize
the shape of a bug, not to turn similar-sounding reports into automatic work.

For a clear bug outside Clips, Design, and Content, call start-builder-for-item
with clearBug true and a short evidence-grounded reason. If multiple reports
describe the same underlying issue, treat them as one similar-feedback cluster:
read and eyeball every report, choose one representative, and call
start-builder-for-item once with the other Factory item ids in relatedItemIds.
The action adds 👀 to every grouped Slack thread but posts one Builder reply in
the representative thread. Do not start one Builder thread per duplicate.
Separate reports only when their failure modes, surfaces, or owners differ.

The Builder reply must tag @builder.io with the dot and tell it to run
/address-feedback. It must point Builder to the relevant repository skills,
the representative source, every related source, and the need to fix the
underlying boundary across the whole cluster. Never add the reaction or tag
Builder for owner-managed Clips, Design, or Content work, or for a non-bug
report.
After classifying each processed item, call start-builder-for-item with clearBug true or false and a short evidence-grounded reason so the skip or dispatch is recorded.

Keep each run bounded. Preserve action errors and do not claim a Builder reply,
PR, merge, or fix unless an action returned that state.
`,
  },
  {
    name: "factory-sentry-errors",
    schedule: "0 9 * * *",
    timezone: "America/Los_Angeles",
    model: FACTORY_DEFAULT_MODEL,
    maxIterations: 24,
    maxRunInputTokens: FACTORY_DEFAULT_MAX_RUN_INPUT_TOKENS,
    body: `
# Factory Sentry error triage

Read the Factory configuration. When Sentry polling is enabled and a Sentry
organization is configured, call poll-sentry-errors. List at most 3 new or
changed errors by passing needsReview true, source sentry, and limit 3. Inspect
the title, culprit, level, event count, and errorReport metadata. Never list the
full queue or use the action's default page size.

Only classify a concrete unresolved error as a clear bug when the Sentry
evidence is sufficient to investigate. Do not dispatch on noise, expected
errors, product ideas, or incomplete provider responses. Clips, Design, and
Content errors are owner-managed and must remain needs_manual.

For each eligible clear bug, call start-builder-for-item with clearBug true,
an evidence-grounded reason, and clearErrorReport containing only the bounded
Sentry evidence. Builder should open a PR; do not claim it did so until the
run callback or PR observation confirms it.
After classifying each processed item, call start-builder-for-item with clearBug true or false and a short evidence-grounded reason so the skip or dispatch is recorded.
`,
  },
  {
    name: "factory-github-issues",
    schedule: "0 * * * *",
    legacySchedules: ["* * * * *", "*/5 * * * *"],
    model: FACTORY_DEFAULT_MODEL,
    maxIterations: FACTORY_DEFAULT_MAX_ITERATIONS,
    maxRunInputTokens: FACTORY_DEFAULT_MAX_RUN_INPUT_TOKENS,
    body: `
# Factory GitHub issue triage

Read the Factory configuration. When GitHub source polling is enabled and a
repository is configured, call poll-github-sources with includeIssues true and
includePullRequests false. List at most 3 new or changed issues by passing
needsReview true, source github_issue, and limit 3. Never list the full queue or
use the action's default page size.

Treat an issue as a clear bug only when it has a concrete error report,
reproduction, incorrect behavior, regression, or specific failing path. Do
not dispatch feature requests, vague questions, or issues without enough
evidence. Clips, Design, and Content remain owner-managed.

For each eligible item call start-builder-for-item with clearBug true,
evidence-grounded reason, and the bounded issue body as clearErrorReport.
Preserve failures and never report a successful Builder run without its action
confirmation.
After classifying each processed item, call start-builder-for-item with clearBug true or false and a short evidence-grounded reason so the skip or dispatch is recorded.
`,
  },
  {
    name: "factory-pr-governance",
    schedule: "*/10 * * * *",
    legacySchedules: ["*/5 * * * *"],
    model: FACTORY_DEFAULT_MODEL,
    maxIterations: 40,
    maxRunInputTokens: 2_000_000,
    body: `
# Factory pull-request governance

Follow the repository's review-prs skill. Read the full PR title, body, linked
issue and source links, complete changed-file diff including generated and
migration files, every human and bot review comment and reply, actual check
conclusions, and the affected ownership boundary. Verify current BuilderIO
organization membership through the GitHub organization API; never infer it
from a name, email, association, branch, or bot label. Never approve external
or unverified authors. Apply the skill's ultra-scary gate for auth, permissions,
tenant isolation, secrets, destructive data loss, RCE, SSRF, payments,
deployment, or unexplained dependency and infrastructure risk. Record failed,
pending, skipped, unknown, and unresolved ordinary feedback accurately - never
call it clean just because the author is internal. Sid's verified Design-owner
exception still does not waive membership or the ultra-scary gate.

Read the Factory configuration. When GitHub polling is enabled and a repository
is configured, call poll-github-sources with includeIssues false and
includePullRequests true. List at most 3 new or changed pull requests by
passing needsReview true, source github, and limit 3. Never list the full queue
or use the action's default page size.

For each open agent-native PR, inspect the item and classify whether it is a
clear bug fix or has product or UX implications. Avoid duplicate review noise
when no commit, review, comment, or check result changed. Call
govern-agent-native-pull-request with the item id, repository, pull request
number, clearBug, productUxImplications, and a short reason. The action fetches
fresh CI and review evidence before approving or merging. For a verified
current BuilderIO member, the internal-author exception means ordinary failed,
pending, skipped, or unknown checks and unresolved ordinary feedback do not by
themselves block approval; record their exact states and never call them clean.
The exception does not waive membership, ownership, or the ultra-scary gate.

Only auto-merge when the PR proves its Factory origin by retaining the Factory
item id or source link in the PR description, or by using the Factory branch
name. A normal open PR must never be treated as a Builder-triggered run.

Never auto-approve or auto-merge Clips, Design, or Content PRs. Those apps are
fully owned by their product owners. Auto-merge is limited to PRs with a
verified Factory Builder run; all other PRs can at most pass the approval
policy. Do not call GitHub write actions directly or claim a merge unless the
governance action confirms it.
`,
  },
  {
    name: "factory-pr-babysit",
    schedule: "*/5 * * * *",
    legacySchedules: ["*/2 * * * *"],
    model: FACTORY_DEFAULT_MODEL,
    maxIterations: FACTORY_DEFAULT_MAX_ITERATIONS,
    maxRunInputTokens: FACTORY_DEFAULT_MAX_RUN_INPUT_TOKENS,
    body: `
# Factory builder-io-bot PR babysitting

Read the Factory configuration. When GitHub polling is enabled and a repository
is configured, call poll-github-sources with includeIssues false and
includePullRequests true. List at most 3 new or changed pull requests by
passing needsReview true, source github, and limit 3. Never list the full queue
or use the action's default page size.

For each item, call babysit-agent-native-pull-request. That action fetches fresh
GitHub and ai-services evidence and is the only place allowed to decide whether
to post the bounded @builderio-bot feedback-fix request. It only acts on open
non-draft PRs authored by builder-io-bot (including GitHub's bot login variants),
and skips owner-managed Clips, Design, and Content work. It persists the latest
feedback fingerprint and quiet window, so repeated scheduler ticks do not spam
comments. A changed commit, new unresolved feedback, failing or pending CI, or
merge conflict starts a new bounded request; twenty minutes without new work to
address ends that babysitting window. The action never approves or merges.

Preserve action errors and never claim that Builder fixed a PR unless fresh
evidence confirms the resulting state.
`,
  },
];

function workspaceOwnerEmail(): string | undefined {
  const email = process.env.WORKSPACE_OWNER_EMAIL?.trim().toLowerCase(); // guard:allow-env-credential - deployment owner identity, not a user credential
  if (!email || /[\r\n]/.test(email)) return undefined;
  return email;
}

function defaultRepository(): string | null {
  const repository = process.env.FACTORY_DEFAULT_REPOSITORY?.trim(); // guard:allow-env-credential - repository configuration, not a credential
  if (!repository || /[\r\n]/.test(repository)) return null;
  return repository;
}

function defaultGithubPollingEnabled(): 0 | 1 {
  return process.env.FACTORY_ENABLE_GITHUB_POLLING?.trim().toLowerCase() === // guard:allow-env-credential - deployment feature flag, not a credential
    "true"
    ? 1
    : 0;
}

function automationPromptGuard(name: string): string | undefined {
  switch (name) {
    case "factory-slack-feedback":
      return "Runtime safety bound: call list-triage-items with needsReview true, source slack, and limit 5; process at most five new Slack items sequentially, and never use the default page size.";
    case "factory-sentry-errors":
      return "Runtime safety bound: call list-triage-items with needsReview true, source sentry, and limit 3; process at most three Sentry items.";
    case "factory-github-issues":
      return "Runtime safety bound: call list-triage-items with needsReview true, source github_issue, and limit 3; process at most three GitHub issue items.";
    case "factory-pr-governance":
    case "factory-pr-babysit":
      return "Runtime safety bound: call list-triage-items with needsReview true, source github, and limit 3; process at most three pull-request items.";
    default:
      return undefined;
  }
}

function setFrontmatterField(
  content: string,
  key: string,
  value: string,
): string {
  if (!content.startsWith("---\n")) return content;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return content;
  const frontmatter = content.slice(4, end);
  const pattern = new RegExp(`^${key}:.*$`, "m");
  if (pattern.test(frontmatter)) {
    return `---\n${frontmatter.replace(pattern, `${key}: ${value}`)}${content.slice(end)}`;
  }
  return `${content.slice(0, end)}\n${key}: ${value}${content.slice(end)}`;
}

function frontmatterField(content: string, key: string): string | undefined {
  if (!content.startsWith("---\n")) return undefined;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return undefined;
  const match = content
    .slice(4, end)
    .match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  const value = match?.[1]?.trim();
  if (!value) return undefined;
  return value.replace(/^(\"|')|((\"|')$)/g, "");
}

function automationContent(
  ownerEmail: string,
  orgId: string,
  seed: AutomationSeed,
): string {
  const body = syncManagedReviewSkillAlignment(
    seed.body.trim(),
    seed.name as FactoryAutomationName,
  );
  return `---
schedule: "${seed.schedule}"
${seed.timezone ? `timezone: ${seed.timezone}\n` : ""}enabled: true
triggerType: schedule
domain: factory
appId: factory
orgId: ${orgId}
createdBy: ${ownerEmail}
runAs: creator
model: ${seed.model}
maxIterations: ${seed.maxIterations}
maxRunInputTokens: ${seed.maxRunInputTokens}
---
${body.trim()}
`;
}

async function disableLegacyObserver(): Promise<void> {
  const existing = await resourceGetByPath(WORKSPACE_OWNER, LEGACY_JOB_PATH);
  if (!existing) return;
  const disabled = setFrontmatterField(existing.content, "enabled", "false");
  if (disabled !== existing.content) {
    await resourcePut(
      WORKSPACE_OWNER,
      LEGACY_JOB_PATH,
      disabled,
      "text/markdown",
    );
  }
}

async function ensureOrganizationAutomations(
  ownerEmail: string,
  orgId: string,
): Promise<void> {
  const owner = organizationResourceOwner(orgId);
  await Promise.all(
    AUTOMATION_SEEDS.map(async (seed) => {
      const path = `jobs/${seed.name}.md`;
      const existing = await resourceGetByPath(owner, path);
      if (!existing) {
        await resourcePut(
          owner,
          path,
          automationContent(ownerEmail, orgId, seed),
          "text/markdown",
        );
        return;
      }

      // Earlier Factory versions created these rows without identity and run
      // budget metadata. Preserve explicit prompt/model/budget edits, while
      // repairing only missing defaults and the old built-in poll cadence.
      let repaired = existing.content;
      repaired = setFrontmatterField(repaired, "triggerType", "schedule");
      repaired = setFrontmatterField(repaired, "domain", "factory");
      repaired = setFrontmatterField(repaired, "appId", "factory");
      repaired = setFrontmatterField(repaired, "orgId", orgId);
      repaired = setFrontmatterField(repaired, "createdBy", ownerEmail);
      repaired = setFrontmatterField(repaired, "runAs", "creator");
      if (!frontmatterField(repaired, "model")) {
        repaired = setFrontmatterField(repaired, "model", seed.model);
      }
      if (!frontmatterField(repaired, "maxIterations")) {
        repaired = setFrontmatterField(
          repaired,
          "maxIterations",
          String(seed.maxIterations),
        );
      }
      if (!frontmatterField(repaired, "maxRunInputTokens")) {
        repaired = setFrontmatterField(
          repaired,
          "maxRunInputTokens",
          String(seed.maxRunInputTokens),
        );
      }
      if (
        (seed.legacySchedules ?? []).includes(
          frontmatterField(repaired, "schedule") ?? "",
        )
      ) {
        repaired = setFrontmatterField(repaired, "schedule", seed.schedule);
      }
      const promptGuard = automationPromptGuard(seed.name);
      if (promptGuard && !repaired.includes(promptGuard)) {
        repaired = `${repaired.trimEnd()}\n\n${promptGuard}\n`;
      }
      if (
        (seed.name === "factory-slack-feedback" ||
          seed.name === "factory-sentry-errors" ||
          seed.name === "factory-github-issues") &&
        !repaired.includes(SKIP_RECORD_GUARD)
      ) {
        repaired = `${repaired.trimEnd()}\n\n${SKIP_RECORD_GUARD}\n`;
      }
      repaired = syncManagedReviewSkillAlignment(
        repaired,
        seed.name as FactoryAutomationName,
      );
      if (repaired === existing.content) return;

      const updated = await resourcePutIfCurrent({
        owner,
        path,
        content: repaired,
        mimeType: "text/markdown",
        expectedId: existing.id,
        expectedUpdatedAt: existing.updatedAt,
        expectedContent: existing.content,
      });
      if (!updated) {
        console.warn(
          `[factory-scheduler-job] skipped metadata repair for ${path}: the resource changed concurrently`,
        );
      }
    }),
  );
}

async function ensureDefaultTriageConfig(
  ownerEmail: string,
  orgId: string,
): Promise<void> {
  const db = getDb();
  const existing = (
    await db
      .select({
        id: triageConfig.id,
      })
      .from(triageConfig)
      .where(and(eq(triageConfig.id, orgId), eq(triageConfig.orgId, orgId)))
      .limit(1)
  )[0];
  const repository = defaultRepository();
  // Existing rows are operator-owned. An empty repository plus disabled
  // polling can be an intentional choice, so do not infer bootstrap state.
  if (existing) return;
  const now = new Date().toISOString();
  await db.insert(triageConfig).values({
    id: orgId,
    slackWorkspace: "primary",
    slackChannelId: DEFAULT_SLACK_CHANNEL_ID,
    slackChannelName: DEFAULT_SLACK_CHANNEL_NAME,
    pollingEnabled: 1,
    githubPollingEnabled: defaultGithubPollingEnabled(),
    sentryPollingEnabled: 0,
    lastSlackTs: null,
    slackHistoryCursor: null,
    repository,
    sentryOrgSlug: null,
    sentryProjectSlug: null,
    sentryEnvironment: null,
    lastSentrySeenAt: null,
    createdAt: now,
    updatedAt: now,
    ownerEmail,
    orgId,
  });
}

async function ensureSchedulerJobs(): Promise<void> {
  let ownerEmail = workspaceOwnerEmail();
  let orgId = ownerEmail ? await resolveOrgIdForEmail(ownerEmail) : undefined;
  if (!ownerEmail || !orgId) {
    const existingConfigs = await getDb()
      .select({
        id: triageConfig.id,
        ownerEmail: triageConfig.ownerEmail,
        orgId: triageConfig.orgId,
      })
      .from(triageConfig)
      .limit(2);
    if (existingConfigs.length !== 1) {
      throw new Error(
        "WORKSPACE_OWNER_EMAIL is required to seed Factory automations when the Factory organization is not uniquely configured",
      );
    }
    const existingConfig = existingConfigs[0];
    ownerEmail = existingConfig.ownerEmail.trim().toLowerCase();
    orgId = existingConfig.orgId?.trim() || existingConfig.id;
  }
  await ensureDefaultTriageConfig(ownerEmail, orgId);
  await ensureOrganizationAutomations(ownerEmail, orgId);
  await disableLegacyObserver();
}

export default defineNitroPlugin(async () => {
  subscribeToAutomationFailures();
  try {
    await ensureSchedulerJobs();
  } catch (error) {
    console.error(
      "[factory-scheduler-job] failed to seed organization automations:",
      error,
    );
  }
});
