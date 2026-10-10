import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { SlackPostMessageResult } from "../server/connectors/slack.js";
import { getDb } from "../server/db/index.js";
import {
  factoryAuditEvents,
  triageDecisions,
  triageItems,
  triageRuns,
} from "../server/db/schema.js";
import { readCallingFactoryAutomation } from "../server/lib/factory-automation-caller.js";
import { requiresSlackFindingsDestination } from "../server/lib/factory-automation-config.js";
import type { FactoryAutomationConfig } from "../server/lib/factory-automation-config.js";
import {
  DEFAULT_FACTORY_ID,
  factoryStillPresent,
  factoryIdSchema,
  orgFactoryItemFilter,
  orgFactoryRunFilter,
  requireExistingFactory,
} from "../server/lib/factory-scope.js";
import { requireFactoryAutomation } from "../server/lib/require-factory-automation.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { recordFactoryAudit } from "../server/triage/audit.js";
import { stableId } from "../server/triage/ids.js";
import {
  metadataString,
  parseTriageMetadata,
  serializeTriageMetadata,
} from "../server/triage/metadata.js";
import { createSlackReader } from "../server/triage/slack-client.js";

const findingSchema = z.object({
  itemId: z.string().trim().min(1).describe("Factory item id from this run."),
  clearBug: z
    .literal(true)
    .describe("The source is a concrete, reproducible bug."),
  risk: z.literal("low").describe("Only low-risk findings can be reported."),
  confidence: z
    .literal("high")
    .describe("Only findings with enough evidence to fix can be reported."),
  productUxImplications: z
    .literal(false)
    .describe("A human does not need to choose product or design direction."),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(1_000)
    .describe("Brief evidence-grounded explanation of the concrete failure."),
});

type Finding = z.infer<typeof findingSchema>;

type FindingSource = {
  id: string;
  source: "github_issue" | "sentry";
  sourceUrl: string | null;
  title: string;
  summary: string | null;
  metadataJson: string;
};

export function reportableFindingSource(input: {
  source: FactoryAutomationConfig["source"];
  template: FactoryAutomationConfig["template"];
}): "github_issue" | "sentry" | null {
  if (input.template === "pr-governance" || input.template === "pr-babysit") {
    return null;
  }
  if (input.source === "github" && requiresSlackFindingsDestination(input)) {
    return "github_issue";
  }
  if (input.source === "sentry" && requiresSlackFindingsDestination(input)) {
    return "sentry";
  }
  return null;
}

function boundedSlackText(value: string, max: number): string {
  const compact = value.trim();
  const safe = compact.replace(/@/g, "＠");
  return safe.length > max ? `${safe.slice(0, max - 1)}…` : safe;
}

export function factoryFindingRollupText(input: {
  factoryId: string;
  source: "github_issue" | "sentry";
  findings: Array<Finding & FindingSource>;
}): string {
  const sourceLabel = input.source === "github_issue" ? "GitHub" : "Sentry";
  const sections = input.findings.map((finding, index) => {
    const metadata = parseTriageMetadata(finding.metadataJson);
    const evidence =
      metadataString(metadata, "errorReport") ??
      finding.summary ??
      finding.title;
    return [
      `*${index + 1}. ${boundedSlackText(finding.title, 200)}*`,
      `Factory item: ${finding.id}`,
      finding.sourceUrl ? `Source: ${finding.sourceUrl}` : "",
      `Why it qualifies: ${boundedSlackText(finding.reason, 1_000)}`,
      `Source evidence:\n${boundedSlackText(evidence, 2_000)}`,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    `Factory ${sourceLabel} findings for ${input.factoryId} (${input.findings.length})`,
    "These findings passed the clear-bug, low-risk, high-confidence gate. Review the linked source evidence and coordinate follow-up in this channel.",
    ...sections,
  ].join("\n\n");
}

export default defineAction({
  description:
    "Post one grouped Slack report for eligible GitHub issue or Sentry findings from the current Factory automation run, using that automation's configured Slack findings channel. This action never creates, comments on, or reacts to GitHub issues. Use it once for the complete eligible batch; record non-eligible items with dispatch-factory-item.",
  schema: z.object({
    factoryId: factoryIdSchema.default(DEFAULT_FACTORY_ID),
    findings: z
      .array(findingSchema)
      .min(1)
      .max(10)
      .describe(
        "Every eligible GitHub or Sentry finding from this run, grouped into one Slack message. A run may report at most 10 items. Do not include skipped items.",
      ),
  }),
  http: false,
  run: async ({ factoryId, findings }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    await requireFactoryAutomation(
      context,
      { userEmail, orgId },
      "builderDispatch",
      factoryId,
    );
    const automationRunId = context?.runId?.trim();
    if (context?.caller !== "automation" || !automationRunId) {
      fail(
        "A Factory automation run id is required to report findings safely.",
        { errorCode: "factory_automation_run_required", statusCode: 400 },
      );
    }
    const job = await readCallingFactoryAutomation(context, {
      userEmail,
      orgId,
    });
    if (!job) {
      fail("This Factory automation could not be identified.", {
        errorCode: "factory_automation_not_found",
        statusCode: 404,
      });
    }
    const source = reportableFindingSource(job.config);
    if (!source) {
      fail("Only GitHub and Sentry Factory automations can report findings.", {
        errorCode: "factory_finding_source_not_supported",
        statusCode: 400,
      });
    }
    const itemIds = findings.map(({ itemId }) => itemId);
    if (new Set(itemIds).size !== itemIds.length) {
      fail("A finding may appear only once in a Slack rollup.", {
        errorCode: "duplicate_factory_finding",
        statusCode: 400,
      });
    }
    const db = getDb();
    const sourceItems = (await db
      .select()
      .from(triageItems)
      .where(
        and(
          orgFactoryItemFilter(orgId, factoryId),
          inArray(triageItems.id, itemIds),
        ),
      )) as FindingSource[];
    if (sourceItems.length !== findings.length) {
      fail(
        "One or more findings are missing from this Factory or organization.",
        { errorCode: "factory_finding_not_found", statusCode: 404 },
      );
    }
    if (sourceItems.some((item) => item.source !== source)) {
      fail(
        `This automation can report only ${source} findings from its Factory.`,
        { errorCode: "factory_finding_source_mismatch", statusCode: 400 },
      );
    }
    const itemById = new Map(sourceItems.map((item) => [item.id, item]));
    const orderedFindings = findings.map((finding) => {
      const item = itemById.get(finding.itemId);
      if (!item) {
        fail("A Factory finding was not found.", {
          errorCode: "factory_finding_not_found",
          statusCode: 404,
        });
      }
      return { ...finding, ...item };
    });

    const channelId = job.config.slackChannelId?.trim();
    if (!channelId) {
      fail(
        "Configure a Slack findings channel on this automation before reporting GitHub or Sentry findings.",
        { errorCode: "slack_findings_channel_required", statusCode: 400 },
      );
    }
    const workspace =
      job.config.slackWorkspace === "secondary" ? "secondary" : "primary";
    const slack = createSlackReader({ ownerEmail: userEmail, orgId });
    await slack.getAgentNativeIdentity(workspace);

    const reportKey = stableId(
      "factory-findings-report",
      orgId,
      factoryId,
      automationRunId,
    );
    const runIds = new Map(
      findings.map(({ itemId }) => [
        itemId,
        stableId("factory-findings-run", reportKey, itemId),
      ]),
    );
    const existingRuns = await db
      .select()
      .from(triageRuns)
      .where(
        and(
          orgFactoryRunFilter(orgId, factoryId),
          eq(triageRuns.dedupeKey, reportKey),
        ),
      );
    if (existingRuns.length > 0) {
      const existingItemIds = existingRuns.map(({ itemId }) => itemId).sort();
      const requestedItemIds = [...itemIds].sort();
      if (
        existingItemIds.length !== requestedItemIds.length ||
        existingItemIds.some((id, index) => id !== requestedItemIds[index])
      ) {
        fail(
          "This automation run already started a different findings report; refusing to split it into extra Slack messages.",
          { errorCode: "factory_report_conflict", statusCode: 409 },
        );
      }
      if (existingRuns.every((run) => run.status === "acknowledged")) {
        return {
          ok: true,
          posted: false,
          deduplicated: true,
          count: findings.length,
          slackMessageTs: existingRuns[0]?.providerTaskId ?? null,
        };
      }
      if (existingRuns.some((run) => run.status !== "failed")) {
        fail(
          "This findings report has an unresolved Slack delivery attempt; refusing to post a possible duplicate.",
          { errorCode: "slack_report_pending", statusCode: 409 },
        );
      }
    }

    const now = new Date().toISOString();
    await db.transaction(async (tx) => {
      if (existingRuns.length > 0) {
        for (const item of orderedFindings) {
          const runId = runIds.get(item.id)!;
          await tx
            .update(triageRuns)
            .set({
              status: "submitted",
              error: null,
              completedAt: null,
              heartbeatAt: now,
              dispatchAttempts:
                (existingRuns.find((run) => run.itemId === item.id)
                  ?.dispatchAttempts ?? 0) + 1,
            })
            .where(
              and(
                eq(triageRuns.id, runId),
                eq(triageRuns.orgId, orgId),
                factoryStillPresent(
                  tx as unknown as typeof db,
                  orgId,
                  factoryId,
                ),
              ),
            );
        }
      } else {
        for (const item of orderedFindings) {
          await tx.insert(triageRuns).values({
            id: runIds.get(item.id)!,
            itemId: item.id,
            source,
            provider: "slack-findings",
            providerTaskId: null,
            dedupeKey: reportKey,
            approvalEmail: null,
            status: "submitted",
            progressLogJson: JSON.stringify([
              {
                at: now,
                state: "submitted",
                reason: "Preparing grouped Slack report.",
              },
            ]),
            dispatchAttempts: 1,
            needsContinuation: 0,
            startedAt: now,
            heartbeatAt: now,
            completedAt: null,
            error: null,
            ownerEmail: userEmail,
            orgId,
            factoryId,
          });
        }
      }
      await requireExistingFactory(
        tx as unknown as typeof db,
        orgId,
        factoryId,
      );
    });

    let posted: SlackPostMessageResult;
    try {
      posted = await slack.postChannelMessage(
        workspace,
        channelId,
        factoryFindingRollupText({
          factoryId,
          source,
          findings: orderedFindings,
        }),
      );
      if (!posted.ts || !posted.channel) {
        fail("Slack response is missing the posted message identity.", {
          errorCode: "slack_invalid_response",
          statusCode: 424,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(triageRuns)
        .set({
          status: "failed",
          error: message,
          completedAt: new Date().toISOString(),
          heartbeatAt: new Date().toISOString(),
        })
        .where(
          and(
            orgFactoryRunFilter(orgId, factoryId),
            eq(triageRuns.dedupeKey, reportKey),
          ),
        );
      for (const item of orderedFindings) {
        await recordFactoryAudit(
          context,
          { userEmail, orgId },
          {
            action: "report-factory-findings",
            kind: "external_action",
            status: "error",
            factoryId,
            itemId: item.id,
            source,
            sourceUrl: item.sourceUrl,
            summary: `Slack findings report failed: ${message}`,
            details: { provider: "slack-findings", reportKey },
          },
        );
      }
      fail(`Factory Slack findings report failed: ${message}`, {
        errorCode: "slack_findings_report_failed",
        statusCode: 424,
      });
    }

    try {
      const acknowledgedAt = new Date().toISOString();
      await db.transaction(async (tx) => {
        for (const item of orderedFindings) {
          const runId = runIds.get(item.id)!;
          const current = (
            await tx
              .select({ metadataJson: triageItems.metadataJson })
              .from(triageItems)
              .where(
                and(
                  eq(triageItems.id, item.id),
                  orgFactoryItemFilter(orgId, factoryId),
                ),
              )
              .limit(1)
          )[0];
          if (!current) {
            fail(`Factory finding ${item.id} disappeared after posting.`, {
              errorCode: "factory_finding_disappeared_after_report",
              statusCode: 500,
            });
          }
          const metadata = parseTriageMetadata(current.metadataJson);
          Object.assign(metadata, {
            slackFindingReportedAt: acknowledgedAt,
            slackFindingReportedTs: posted.ts,
            slackFindingReportedChannelId: posted.channel,
          });
          await tx
            .update(triageItems)
            .set({
              status: "automation_started",
              risk: "low",
              confidence: "high",
              metadataJson: serializeTriageMetadata(metadata),
              updatedAt: acknowledgedAt,
            })
            .where(
              and(
                eq(triageItems.id, item.id),
                orgFactoryItemFilter(orgId, factoryId),
              ),
            );
          await tx
            .update(triageRuns)
            .set({
              status: "acknowledged",
              providerTaskId: posted.ts,
              progressLogJson: JSON.stringify([
                {
                  at: now,
                  state: "submitted",
                  reason: "Preparing grouped Slack report.",
                },
                {
                  at: acknowledgedAt,
                  state: "acknowledged",
                  reason: `Reported in the configured Slack channel ${posted.channel}.`,
                },
              ]),
              heartbeatAt: acknowledgedAt,
            })
            .where(
              and(
                eq(triageRuns.id, runId),
                eq(triageRuns.orgId, orgId),
                factoryStillPresent(
                  tx as unknown as typeof db,
                  orgId,
                  factoryId,
                ),
              ),
            );
          const decisionId = stableId(
            "decision",
            orgId,
            item.id,
            "factory-slack-findings",
            automationRunId,
          );
          await tx
            .insert(triageDecisions)
            .values({
              id: decisionId,
              itemId: item.id,
              ruleId: null,
              mode: "automation",
              outcome: "propose_fix",
              reason: item.reason,
              guardResultsJson: JSON.stringify([
                {
                  code: "unknown_change",
                  passed: true,
                  reason: "Concrete bug evidence was confirmed.",
                },
                {
                  code: "unknown_change",
                  passed: true,
                  reason: "No product or UX decision is required.",
                },
                { code: "risk_gate", passed: true, reason: "Risk is low." },
                {
                  code: "confidence_gate",
                  passed: true,
                  reason: "Confidence is high.",
                },
              ]),
              model: "factory-automation",
              promptVersion: 1,
              createdAt: acknowledgedAt,
              ownerEmail: userEmail,
              orgId,
              factoryId,
            })
            .onConflictDoUpdate({
              target: triageDecisions.id,
              set: {
                outcome: "propose_fix",
                reason: item.reason,
                createdAt: acknowledgedAt,
                ownerEmail: userEmail,
              },
            });
          await tx.insert(factoryAuditEvents).values({
            id: stableId("factory-findings-audit", reportKey, item.id),
            automationRunId,
            automationThreadId: context.threadId ?? null,
            automationName: context.automation?.triggerName ?? null,
            factoryId,
            itemId: item.id,
            source,
            sourceUrl: item.sourceUrl,
            action: "report-factory-findings",
            kind: "external_action",
            status: "success",
            summary: "Reported this finding in the configured Slack channel.",
            detailsJson: JSON.stringify({
              provider: "slack-findings",
              reportKey,
              channelId: posted.channel,
              messageTs: posted.ts,
            }),
            createdAt: acknowledgedAt,
            ownerEmail: userEmail,
            orgId,
          });
        }
        await requireExistingFactory(
          tx as unknown as typeof db,
          orgId,
          factoryId,
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(
        `Slack posted the Factory findings report, but Factory could not record its acknowledgement: ${message}`,
        {
          errorCode: "factory_report_reconciliation_required",
          statusCode: 500,
        },
      );
    }

    return {
      ok: true,
      posted: true,
      deduplicated: false,
      count: findings.length,
      slackChannelId: posted.channel,
      slackMessageTs: posted.ts,
      itemIds,
    };
  },
});
