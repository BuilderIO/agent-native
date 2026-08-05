import { resolveOrgIdForEmail } from "@agent-native/core/org";
import {
  organizationResourceOwner,
  resourceGetByPath,
  resourcePut,
  WORKSPACE_OWNER,
} from "@agent-native/core/resources";
import { defineNitroPlugin } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { triageConfig } from "../db/schema.js";

const LEGACY_JOB_PATH = "jobs/factory-observation-scheduler.md";
const DEFAULT_SLACK_CHANNEL_ID = "C0ATH3CCZT4";
const DEFAULT_SLACK_CHANNEL_NAME = "product-agent-native-feedback";

type AutomationSeed = {
  name: string;
  schedule: string;
  timezone?: string;
  body: string;
};

const AUTOMATION_SEEDS: AutomationSeed[] = [
  {
    name: "factory-slack-feedback",
    schedule: "* * * * *",
    body: `
# Factory Slack feedback triage

Read the Factory configuration. When Slack polling is enabled and a channel is
configured, call poll-slack-channel first. Then list a bounded page of
received Slack items and call get-slack-feedback-context for each item before
classifying it.

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
with clearBug true and a short evidence-grounded reason. That action adds the
eyes reaction and tags @builderio in the Slack thread, asking Builder to fix
it in a reply and send a PR. Never add the reaction or tag Builder for
owner-managed Clips, Design, or Content work, or for a non-bug report.

Keep each run bounded. Preserve action errors and do not claim a Builder reply,
PR, merge, or fix unless an action returned that state.
`,
  },
  {
    name: "factory-sentry-errors",
    schedule: "0 9 * * *",
    timezone: "America/Los_Angeles",
    body: `
# Factory Sentry error triage

Read the Factory configuration. When Sentry polling is enabled and a Sentry
organization is configured, call poll-sentry-errors. List a bounded page of
received Sentry items and inspect the title, culprit, level, event count, and
errorReport metadata.

Only classify a concrete unresolved error as a clear bug when the Sentry
evidence is sufficient to investigate. Do not dispatch on noise, expected
errors, product ideas, or incomplete provider responses. Clips, Design, and
Content errors are owner-managed and must remain needs_manual.

For each eligible clear bug, call start-builder-for-item with clearBug true,
an evidence-grounded reason, and clearErrorReport containing only the bounded
Sentry evidence. Builder should open a PR; do not claim it did so until the
run callback or PR observation confirms it.
`,
  },
  {
    name: "factory-github-issues",
    schedule: "* * * * *",
    body: `
# Factory GitHub issue triage

Read the Factory configuration. When GitHub source polling is enabled and a
repository is configured, call poll-github-sources with includeIssues true and
includePullRequests false. List a bounded page of received github_issue items.

Treat an issue as a clear bug only when it has a concrete error report,
reproduction, incorrect behavior, regression, or specific failing path. Do
not dispatch feature requests, vague questions, or issues without enough
evidence. Clips, Design, and Content remain owner-managed.

For each eligible item call start-builder-for-item with clearBug true,
evidence-grounded reason, and the bounded issue body as clearErrorReport.
Preserve failures and never report a successful Builder run without its action
confirmation.
`,
  },
  {
    name: "factory-pr-governance",
    schedule: "*/5 * * * *",
    body: `
# Factory pull-request governance

Read the Factory configuration. When GitHub polling is enabled and a repository
is configured, call poll-github-sources with includeIssues false and
includePullRequests true. List a bounded page of github pull-request items.

For each open agent-native PR, inspect the item and classify whether it is a
clear bug fix or has product or UX implications. Call
govern-agent-native-pull-request with the item id, repository, pull request
number, clearBug, productUxImplications, and a short reason. The action fetches
fresh CI and review evidence before approving or merging. Clear internal bug
fixes with passing CI and handled review feedback may be auto-approved.

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
];

function workspaceOwnerEmail(): string | undefined {
  const email = process.env.WORKSPACE_OWNER_EMAIL?.trim().toLowerCase(); // guard:allow-env-credential - deployment owner identity, not a user credential
  if (!email || /[\r\n]/.test(email)) return undefined;
  return email;
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

function automationContent(
  ownerEmail: string,
  orgId: string,
  seed: AutomationSeed,
): string {
  return `---
schedule: "${seed.schedule}"
${seed.timezone ? `timezone: ${seed.timezone}\n` : ""}enabled: true
triggerType: schedule
domain: factory
orgId: ${orgId}
createdBy: ${ownerEmail}
runAs: creator
---
${seed.body.trim()}
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
  for (const seed of AUTOMATION_SEEDS) {
    const path = `jobs/${seed.name}.md`;
    if (await resourceGetByPath(owner, path)) continue;
    await resourcePut(
      owner,
      path,
      automationContent(ownerEmail, orgId, seed),
      "text/markdown",
    );
  }
}

async function ensureDefaultTriageConfig(
  ownerEmail: string,
  orgId: string,
): Promise<void> {
  const db = getDb();
  const existing = (
    await db
      .select({ id: triageConfig.id })
      .from(triageConfig)
      .where(and(eq(triageConfig.id, orgId), eq(triageConfig.orgId, orgId)))
      .limit(1)
  )[0];
  if (existing) return;
  const now = new Date().toISOString();
  await db.insert(triageConfig).values({
    id: orgId,
    slackWorkspace: "primary",
    slackChannelId: DEFAULT_SLACK_CHANNEL_ID,
    slackChannelName: DEFAULT_SLACK_CHANNEL_NAME,
    pollingEnabled: 1,
    githubPollingEnabled: 0,
    sentryPollingEnabled: 0,
    lastSlackTs: null,
    slackHistoryCursor: null,
    repository: null,
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
  const ownerEmail = workspaceOwnerEmail();
  if (!ownerEmail) {
    throw new Error(
      "WORKSPACE_OWNER_EMAIL is required to seed Factory automations",
    );
  }
  const orgId = await resolveOrgIdForEmail(ownerEmail);
  if (!orgId) {
    throw new Error(
      "The Factory deployment owner must belong to an organization before automations can be seeded",
    );
  }
  await ensureDefaultTriageConfig(ownerEmail, orgId);
  await ensureOrganizationAutomations(ownerEmail, orgId);
  await disableLegacyObserver();
}

export default defineNitroPlugin(async () => {
  try {
    await ensureSchedulerJobs();
  } catch (error) {
    console.error(
      "[factory-scheduler-job] failed to seed organization automations:",
      error,
    );
  }
});
