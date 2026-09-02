import { subscribe } from "@agent-native/core/event-bus";
import { notify } from "@agent-native/core/notifications";
import { resolveOrgIdForEmail } from "@agent-native/core/org";
import {
  organizationResourceOwner,
  resourceDeleteByPath,
  resourceGetByPath,
  resourceList,
  resourcePut,
  resourcePutIfCurrent,
  WORKSPACE_OWNER,
} from "@agent-native/core/resources";
import {
  defineNitroPlugin,
  runWithRequestContext,
} from "@agent-native/core/server";
import {
  deleteAutomationRuns,
  listAutomationDefinitions,
} from "@agent-native/core/triggers";
import { and, eq, isNull, lt, ne, or } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { triageConfig } from "../db/schema.js";
import { renameFactoryActionMentions } from "../lib/factory-action-names.js";
import {
  applyAutomationConfigFrontmatter,
  buildGuardrailsText,
  defaultAutomationConfig,
  inferAutomationSource,
  readFactoryAutomationConfig,
  replaceUserPrompt,
  scheduleCron,
  seedNameForTemplate,
  slugifyAutomationLeaf,
  sourceForTemplate,
  stripInjectedAutomationBlocks,
  templateIdForSeedName,
  wrapGuardrails,
  type FactoryAutomationConfig,
  type FactoryAutomationTemplateId,
} from "../lib/factory-automation-config.js";
import { repairFactoryAutomationsFromConfig } from "../lib/factory-automation-repair.js";
import {
  DEFAULT_FACTORY_ID,
  assignCreatedByIfMissing,
  factoryAutomationJobPath,
  factoryAutomationJobPrefix,
  factoryAutomationLeafName,
  factoryAutomationRunHistoryKey,
  factoryConfigRowId,
  readAutomationFactoryId,
  readFactoryIdFromAutomationPath,
  readTriageConfigRow,
  setAutomationFrontmatterField,
} from "../lib/factory-scope.js";
import { persistGitHubRepository } from "../lib/github-repository.js";
import {
  BABYSIT_SCOPE_INSTRUCTION,
  repairPrBabysitPrompt,
} from "../lib/pr-babysit-prompt.js";
import { repairSlackFeedbackPrompt } from "../lib/slack-feedback-prompt.js";
import {
  syncManagedReviewSkillAlignment,
  type FactoryAutomationName,
} from "../triage/review-skill-alignment.js";

const LEGACY_JOB_PATH = "jobs/factory-observation-scheduler.md";
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
    (!event.path.startsWith("jobs/factory-") &&
      !event.path.startsWith("jobs/factories/"))
  ) {
    return;
  }

  const db = getDb();
  const factoryId =
    readFactoryIdFromAutomationPath(event.path) ?? DEFAULT_FACTORY_ID;
  const config = await readTriageConfigRow(db, event.orgId, factoryId);
  if (!config || config.automationFailureAlertsEnabled !== 1) return;

  const recipient = (
    config.automationFailureAlertEmail ||
    config.ownerEmail ||
    ""
  )
    .trim()
    .toLowerCase();
  if (!recipient) return;

  const error =
    event.error ||
    "The automation ended without recording a terminal result. No delivery was confirmed.";
  const alertKey = `${event.automation}\n${error}`.slice(0, 700);
  const now = new Date();
  const cutoff = new Date(now.getTime() - FAILURE_ALERT_COOLDOWN_MS);
  const configRowId = factoryConfigRowId(event.orgId, factoryId);
  const claimed = await db
    .update(triageConfig)
    .set({
      lastAutomationFailureAlertKey: alertKey,
      lastAutomationFailureAlertAt: now.toISOString(),
    })
    .where(
      and(
        eq(triageConfig.id, configRowId),
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
    ? `${url}/factory?factoryId=${encodeURIComponent(factoryId)}&tab=automations`
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

const FACTORY_DEFAULT_MODEL = "gpt-5.6-luna";
const FACTORY_DEFAULT_MAX_ITERATIONS = 32;
const FACTORY_DEFAULT_MAX_RUN_INPUT_TOKENS = 1_000_000;
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

List needsReview Slack items after poll-slack-channel. Call
get-slack-feedback-context for each one. A truncated or unreadable thread is
not a clear bug.

A clear bug is a concrete broken behavior, reproducible failure, error,
regression, stuck run, incorrect result, or a specific failing path with
enough evidence to investigate — including visual/UI defects such as a
duplicate control or broken layout. Feature requests, vague questions, and
incomplete threads are not.

For each item, call dispatch-factory-item with clearBug true or false,
productUxImplications false unless it is a pure product or design decision
with no single correct fix, a short reason, and reaction robot_face 🤖.
Cluster only items listed in this run: one dispatch with relatedItemIds. Do
not dispatch needs_manual items or items that already started.

Preserve action errors. Do not claim a Builder reply, PR, merge, or fix
unless an action returned that state.
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

For each eligible clear bug, call dispatch-factory-item with clearBug true,
an evidence-grounded reason, and clearErrorReport containing only the bounded
Sentry evidence. That action opens or reuses a GitHub issue in the factory
repository and tags @builderio-bot. Do not claim a PR exists until GitHub
evidence confirms it.
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

For each eligible item call dispatch-factory-item with clearBug true,
evidence-grounded reason, and the bounded issue body as clearErrorReport.
That action comments @builderio-bot on the GitHub issue. Preserve failures
and never report a successful Builder run without its action confirmation.
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

For the exact \`liamdebeasi\` login and immutable GitHub user ID \`2721089\`, keep
current BuilderIO membership mandatory. If the current, non-draft PR has no
current-head, non-dismissed approval, the Liam exception permits approval
through ordinary check, review-feedback, scope, and UX-owner gates. It never
waives ultra-scary review or the independent-review requirement for changes to
review/approval policy, agent-safety instructions, membership verification, or
CI/deployment security controls, and it never authorizes a merge.

Read the Factory configuration. When GitHub polling is enabled and a repository
is configured, call poll-github-sources with includeIssues false and
includePullRequests true. List at most 3 new or changed pull requests by
passing needsReview true, source github, and limit 3. Never list the full queue
or use the action's default page size.

For each open factory-repository PR, inspect the item and classify whether it is a
clear bug fix or has product or UX implications. Avoid duplicate review noise
when no commit, review, comment, or check result changed. Call
govern-factory-pull-request with the item id, repository, pull request
number, clearBug, productUxImplications, and a short reason. The action fetches
fresh GitHub CI, review, and changed-file evidence before approving. For a verified current BuilderIO
member, the internal-author exception means ordinary failed, pending, skipped,
or unknown checks and unresolved ordinary feedback do not by themselves block
approval; record their exact states and never call them clean. Active credible
safety findings in fresh review evidence always block approval. Apply the
verified Alice/Content, Nick/Slides, Enzo/Factory-specific, Sid/Design, and
docs-only owner exceptions from review-prs only after membership and an
explicit ultra-scary assessment. Those exceptions do not waive membership,
external-author, or ultra-scary gates.

Never auto-merge. Approval is the only GitHub write this workflow may request;
a normal open PR must never be treated as a Builder-triggered run.

Never auto-dispatch Clips, Design, or Content feedback. Those apps remain
fully owned by their product owners for feedback work, while the verified
PR-owner exceptions still apply to their own scoped PRs. Do not call GitHub
write actions directly or claim an approval unless the governance action
confirms it.
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
# Factory PR babysitting

Read the Factory configuration. When GitHub polling is enabled and a repository
is configured, call poll-github-sources with includeIssues false and
includePullRequests true. List at most 3 new or changed pull requests by
passing needsReview true, source github, and limit 3. Never list the full queue
or use the action's default page size. Each item includes author.

${BABYSIT_SCOPE_INSTRUCTION}

When inScope is true, call babysit-factory-pull-request. It owns GitHub
evidence, the hardcoded comment, and the quiet window. Never approve or merge.
Preserve action errors.
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
  return persistGitHubRepository(repository);
}

function defaultGithubPollingEnabled(): 0 | 1 {
  return process.env.FACTORY_ENABLE_GITHUB_POLLING?.trim().toLowerCase() === // guard:allow-env-credential - deployment feature flag, not a credential
    "true"
    ? 1
    : 0;
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
  return value.replace(/^("|')|(("|')$)/g, "");
}

function automationFactoryScopeInstruction(factoryId: string): string {
  return `This automation runs for factory \`${factoryId}\`. Pass \`factoryId: "${factoryId}"\` on every Factory triage, poll, and config action in this run.`;
}

function repairAutomationFactoryScopeInstruction(
  content: string,
  factoryId: string,
): string {
  if (content.includes(`Pass \`factoryId: "${factoryId}"\``)) {
    return content;
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    return `${automationFactoryScopeInstruction(factoryId)}\n\n${content.trim()}\n`;
  }
  const insertAt = end + 4;
  return `${content.slice(0, insertAt)}\n\n${automationFactoryScopeInstruction(factoryId)}\n${content.slice(insertAt)}`;
}

function automationContent(
  ownerEmail: string,
  orgId: string,
  factoryId: string,
  seed: AutomationSeed,
  enabled = true,
  config?: FactoryAutomationConfig,
  displayName?: string,
  userPrompt?: string,
): string {
  const alignmentName = seed.name as FactoryAutomationName;
  const body = syncManagedReviewSkillAlignment(
    (userPrompt?.trim() || seed.body).trim(),
    alignmentName,
  );
  const resolved = config ?? defaultAutomationConfig("slack", "blank");
  let content = `---
schedule: "${scheduleCron(resolved)}"
${resolved.timezone ? `timezone: ${resolved.timezone}\n` : ""}enabled: ${enabled ? "true" : "false"}
triggerType: schedule
domain: factory
appId: factory
orgId: ${orgId}
factoryId: ${factoryId}
createdBy: ${ownerEmail}
runAs: creator
model: ${seed.model}
maxIterations: ${seed.maxIterations}
maxRunInputTokens: ${seed.maxRunInputTokens}
---
${wrapGuardrails(buildGuardrailsText(factoryId, resolved))}

${body.trim()}
`;
  content = applyAutomationConfigFrontmatter(content, resolved);
  if (displayName?.trim()) {
    content = setAutomationFrontmatterField(
      content,
      "displayName",
      displayName.trim(),
    );
  }
  return replaceUserPrompt(content, body.trim());
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

export async function ensureFactoryAutomations(
  ownerEmail: string,
  orgId: string,
  factoryId: string,
  _options?: { enabled?: boolean; enabledNames?: ReadonlySet<string> },
): Promise<void> {
  const owner = organizationResourceOwner(orgId);
  await Promise.all(
    AUTOMATION_SEEDS.map(async (seed) => {
      const path = factoryAutomationJobPath(factoryId, seed.name);
      const existing = await resourceGetByPath(owner, path);
      if (!existing) {
        return;
      }

      // Earlier Factory versions created these rows without identity and run
      // budget metadata. Preserve explicit prompt/model/budget edits, while
      // repairing only missing defaults and the old built-in poll cadence.
      let repaired = renameFactoryActionMentions(existing.content);
      repaired = setFrontmatterField(repaired, "triggerType", "schedule");
      repaired = setFrontmatterField(repaired, "domain", "factory");
      repaired = setFrontmatterField(repaired, "appId", "factory");
      repaired = setFrontmatterField(repaired, "orgId", orgId);
      repaired = setFrontmatterField(repaired, "factoryId", factoryId);
      repaired = assignCreatedByIfMissing(repaired, ownerEmail);
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
      repaired = syncManagedReviewSkillAlignment(
        repaired,
        seed.name as FactoryAutomationName,
      );
      if (seed.name === "factory-slack-feedback") {
        repaired = repairSlackFeedbackPrompt(repaired);
      }
      if (seed.name === "factory-pr-babysit") {
        repaired = repairPrBabysitPrompt(repaired);
      }
      repaired = repairAutomationFactoryScopeInstruction(repaired, factoryId);
      const inferredSource =
        inferAutomationSource(seed.name, repaired) ?? "slack";
      const existingConfig = readFactoryAutomationConfig(repaired, seed.name);
      repaired = applyAutomationConfigFrontmatter(repaired, {
        ...existingConfig,
        source: existingConfig.source || inferredSource,
        template:
          existingConfig.template === "blank"
            ? templateIdForSeedName(seed.name)
            : existingConfig.template,
      });
      repaired = replaceUserPrompt(
        repaired,
        stripInjectedAutomationBlocks(repaired),
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

export const repairExistingFactoryAutomations = ensureFactoryAutomations;

export type FactoryAutomationSnapshot = {
  path: string;
  content: string;
};

export async function listFactoryAutomationResources(
  ownerEmail: string,
  orgId: string,
  factoryId: string,
): Promise<
  Array<{
    id: string;
    name: string;
    path: string;
    content: string;
    enabled: boolean;
  }>
> {
  const definitions = await listAutomationDefinitions(
    { userEmail: ownerEmail, orgId, appId: "factory" },
    "organization",
  );
  return definitions
    .filter(
      ({ meta, resource }) =>
        meta.domain === "factory" &&
        readAutomationFactoryId(meta, resource.content, resource.path) ===
          factoryId,
    )
    .map(({ resource, name, meta }) => ({
      id: resource.id,
      name,
      path: resource.path,
      content: resource.content,
      enabled: meta.enabled,
    }));
}

export async function listFactoryAutomationCleanupPaths(
  orgId: string,
  factoryId: string,
  ownerEmail?: string,
): Promise<string[]> {
  const owner = organizationResourceOwner(orgId);
  const prefixResources = await resourceList(
    owner,
    factoryAutomationJobPrefix(factoryId),
  );
  const paths = new Set(
    prefixResources
      .map((resource) => resource.path)
      .filter((path) => path.trim().length > 0),
  );
  if (ownerEmail) {
    const discovered = await listFactoryAutomationResources(
      ownerEmail,
      orgId,
      factoryId,
    );
    for (const resource of discovered) {
      paths.add(resource.path);
    }
  }
  return [...paths].sort();
}

export async function snapshotFactoryAutomations(
  ownerEmail: string,
  orgId: string,
  factoryId: string,
): Promise<FactoryAutomationSnapshot[]> {
  const owner = organizationResourceOwner(orgId);
  const paths = await listFactoryAutomationCleanupPaths(
    orgId,
    factoryId,
    ownerEmail,
  );
  const snapshots: FactoryAutomationSnapshot[] = [];
  for (const path of paths) {
    const resource = await resourceGetByPath(owner, path);
    if (!resource) {
      throw new Error(
        `Factory automation ${path} is unreadable and cannot be snapshotted.`,
      );
    }
    snapshots.push({ path, content: resource.content });
  }
  return snapshots;
}

export async function restoreFactoryAutomationSnapshots(
  orgId: string,
  snapshots: readonly FactoryAutomationSnapshot[],
): Promise<void> {
  const owner = organizationResourceOwner(orgId);
  await Promise.all(
    snapshots.map((snapshot) =>
      resourcePut(owner, snapshot.path, snapshot.content, "text/markdown"),
    ),
  );
}

function blankAutomationSeed(
  source: FactoryAutomationConfig["source"],
  leafName: string,
): AutomationSeed {
  return {
    name: leafName,
    schedule: "*/5 * * * *",
    model: FACTORY_DEFAULT_MODEL,
    maxIterations: FACTORY_DEFAULT_MAX_ITERATIONS,
    maxRunInputTokens: FACTORY_DEFAULT_MAX_RUN_INPUT_TOKENS,
    body: `# Factory ${source} automation\n`,
  };
}

export async function createFactoryAutomation(
  ownerEmail: string,
  orgId: string,
  factoryId: string,
  input: {
    displayName: string;
    prompt: string;
    config: FactoryAutomationConfig;
    enabled?: boolean;
  },
): Promise<{ id: string; name: string; path: string }> {
  const owner = organizationResourceOwner(orgId);
  const existing = await listFactoryAutomationResources(
    ownerEmail,
    orgId,
    factoryId,
  );
  const taken = new Set(
    existing.map((resource) => factoryAutomationLeafName(resource.path)),
  );
  const preferred =
    seedNameForTemplate(input.config.template) ??
    slugifyAutomationLeaf(input.config.source, input.displayName);
  let leafName = preferred;
  let suffix = 2;
  while (taken.has(leafName)) {
    leafName = `${preferred}-${suffix}`;
    suffix += 1;
  }
  const seed =
    AUTOMATION_SEEDS.find((entry) => entry.name === preferred) ??
    blankAutomationSeed(input.config.source, leafName);
  const path = factoryAutomationJobPath(factoryId, leafName);
  const content = automationContent(
    ownerEmail,
    orgId,
    factoryId,
    { ...seed, name: leafName },
    input.enabled ?? false,
    input.config,
    input.displayName,
    input.prompt,
  );
  const written = await resourcePut(owner, path, content, "text/markdown");
  return {
    id: written.id,
    name: factoryAutomationLeafName(path),
    path,
  };
}

export function factoryAutomationTemplateSeed(
  template: FactoryAutomationTemplateId,
): AutomationSeed | null {
  const name = seedNameForTemplate(template);
  if (!name) return null;
  return AUTOMATION_SEEDS.find((seed) => seed.name === name) ?? null;
}

export function factoryAutomationTemplatePrompt(
  template: FactoryAutomationTemplateId,
  source: FactoryAutomationConfig["source"],
): string {
  const seed = factoryAutomationTemplateSeed(template);
  if (seed) return seed.body.trim();
  return `# Factory ${source} automation\n`;
}

export { sourceForTemplate };

export async function listEnabledFactoryAutomationNames(
  ownerEmail: string,
  orgId: string,
  factoryId: string,
): Promise<Set<string>> {
  const resources = await listFactoryAutomationResources(
    ownerEmail,
    orgId,
    factoryId,
  );
  return new Set(
    resources
      .filter((resource) => resource.enabled)
      .map((resource) => factoryAutomationLeafName(resource.path)),
  );
}

export async function removeFactoryAutomationResources(
  orgId: string,
  factoryId: string,
  ownerEmail?: string,
  extraPaths: readonly string[] = [],
): Promise<void> {
  const owner = organizationResourceOwner(orgId);
  const listed = await listFactoryAutomationCleanupPaths(
    orgId,
    factoryId,
    ownerEmail,
  );
  const seedFallback = ownerEmail
    ? []
    : AUTOMATION_SEEDS.map((seed) =>
        factoryAutomationJobPath(factoryId, seed.name),
      );
  const paths = [...new Set([...listed, ...extraPaths, ...seedFallback])];
  await Promise.all(paths.map((path) => resourceDeleteByPath(owner, path)));
  const remaining = await listFactoryAutomationCleanupPaths(
    orgId,
    factoryId,
    ownerEmail,
  );
  if (remaining.length > 0) {
    throw new Error(
      `Factory automation cleanup could not delete: ${remaining.join(", ")}.`,
    );
  }
}

export async function removeFactoryAutomationRunHistory(
  orgId: string,
  factoryId: string,
  ownerEmail?: string,
  extraPaths: readonly string[] = [],
): Promise<void> {
  const owner = organizationResourceOwner(orgId);
  const listed = await listFactoryAutomationCleanupPaths(
    orgId,
    factoryId,
    ownerEmail,
  );
  const paths = [...new Set([...listed, ...extraPaths])];
  await Promise.all(
    paths
      .filter((path) => path.endsWith(".md"))
      .map((path) =>
        deleteAutomationRuns(owner, factoryAutomationRunHistoryKey(path)),
      ),
  );
}

async function ensureDefaultTriageConfig(
  ownerEmail: string,
  orgId: string,
): Promise<void> {
  const db = getDb();
  const factoryId = DEFAULT_FACTORY_ID;
  const existing = await readTriageConfigRow(db, orgId, factoryId);
  if (existing) {
    await repairFactoryAutomationsFromConfig(ownerEmail, orgId, factoryId);
    return;
  }
  const now = new Date().toISOString();
  const repository = defaultRepository();
  const githubPollingEnabled = defaultGithubPollingEnabled() ? 1 : 0;
  await db.insert(triageConfig).values({
    id: factoryConfigRowId(orgId, factoryId),
    factoryId,
    slackWorkspace: "primary",
    slackChannelId: null,
    slackChannelName: null,
    builderSlackUserId: null,
    pollingEnabled: 0,
    githubPollingEnabled,
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
  await repairFactoryAutomationsFromConfig(ownerEmail, orgId, factoryId);
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
        "WORKSPACE_OWNER_EMAIL is required to repair Factory automations when the Factory organization is not uniquely configured",
      );
    }
    const existingConfig = existingConfigs[0];
    ownerEmail = existingConfig.ownerEmail.trim().toLowerCase();
    orgId = existingConfig.orgId?.trim() || existingConfig.id;
  }
  await ensureDefaultTriageConfig(ownerEmail, orgId);
  await disableLegacyObserver();
}

export default defineNitroPlugin(async () => {
  subscribeToAutomationFailures();
  try {
    await ensureSchedulerJobs();
  } catch (error) {
    console.error(
      "[factory-scheduler-job] failed to repair organization automations:",
      error,
    );
  }
});
