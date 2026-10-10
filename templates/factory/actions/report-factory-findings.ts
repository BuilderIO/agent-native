import { defineAction, fail } from "@agent-native/core/action";
import { and, asc, desc, eq, inArray, like } from "drizzle-orm";
import { z } from "zod";

import type {
  ChannelHistoryResult,
  SlackPostMessageResult,
} from "../server/connectors/slack.js";
import { SlackWriteError } from "../server/connectors/slack.js";
import { getDb } from "../server/db/index.js";
import {
  factoryAuditEvents,
  triageDecisions,
  triageItems,
  triageRuns,
} from "../server/db/schema.js";
import { readCallingFactoryAutomation } from "../server/lib/factory-automation-caller.js";
import {
  QA_AGENT_NATIVE_SLACK_CHANNEL_ID,
  requiresSlackFindingsDestination,
} from "../server/lib/factory-automation-config.js";
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

export function factoryFindingsReportKey(input: {
  orgId: string;
  factoryId: string;
  source: "github_issue" | "sentry";
  itemIds: string[];
}): string {
  return stableId(
    "factory-findings-report",
    input.orgId,
    input.factoryId,
    input.source,
    ...[...input.itemIds].sort(),
  );
}

export function isSlackReportRejectionRetryable(
  run: { status: string; error: string | null; completedAt: string | null },
  now = Date.now(),
): boolean {
  if (run.status !== "failed" || !run.error?.startsWith("slack-rejected: ")) {
    return false;
  }
  const retryAfter = run.error.match(/\bretry-after=(\d+)\b/)?.[1];
  if (retryAfter === undefined) return true;
  const rejectedAt = run.completedAt ? Date.parse(run.completedAt) : Number.NaN;
  return (
    Number.isFinite(rejectedAt) &&
    now >= rejectedAt + Number(retryAfter) * 1_000
  );
}

function isSlackRateLimitWaiting(
  run: { status: string; error: string | null; completedAt: string | null },
  now: number,
): boolean {
  if (run.status !== "failed" || !run.error?.startsWith("slack-rejected: ")) {
    return false;
  }
  const retryAfter = run.error.match(/\bretry-after=(\d+)\b/)?.[1];
  if (retryAfter === undefined) return false;
  const rejectedAt = run.completedAt ? Date.parse(run.completedAt) : Number.NaN;
  return (
    !Number.isFinite(rejectedAt) ||
    now < rejectedAt + Number(retryAfter) * 1_000
  );
}

function boundedSlackText(value: string, max: number): string {
  const compact = value.trim();
  const safe = compact
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@/g, "＠")
    .replace(
      /[*_~`]/g,
      (character) => ({ "*": "∗", _: "＿", "~": "～", "`": "｀" })[character]!,
    );
  return safe.length > max ? `${safe.slice(0, max - 1)}…` : safe;
}

export function factoryFindingRollupText(input: {
  factoryId: string;
  reportKey: string;
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
      `${index + 1}. ${boundedSlackText(finding.title, 160)}`,
      `Factory item: ${boundedSlackText(finding.id, 160)}`,
      finding.sourceUrl
        ? `Source: ${boundedSlackText(finding.sourceUrl, 750)}`
        : "",
      `Why it qualifies: ${boundedSlackText(finding.reason, 500)}`,
      `Source evidence:\n${boundedSlackText(evidence, 1_000)}`,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    `Factory ${sourceLabel} findings for ${boundedSlackText(input.factoryId, 200)} (${input.findings.length})`,
    "These findings passed the clear-bug, low-risk, high-confidence gate. Review the linked source evidence and coordinate follow-up in this channel.",
    `Report reference: ${input.reportKey}`,
    ...sections,
  ].join("\n\n");
}

export async function findSlackReportMessage(input: {
  readHistory: (cursor?: string) => Promise<ChannelHistoryResult>;
  channelId: string;
  marker: string;
  startedAt: string;
}): Promise<SlackPostMessageResult | null> {
  const startedAtMs = Date.parse(input.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    fail("The Slack report start time is invalid.", {
      errorCode: "slack_report_reconciliation_incomplete",
      statusCode: 424,
    });
  }
  const earliestRelevantTs = startedAtMs / 1_000 - 300;
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await input.readHistory(cursor);
    const found = result.messages.find((message) =>
      message.text.includes(input.marker),
    );
    if (found) {
      return { channel: input.channelId, ts: found.ts };
    }
    const oldestTs = result.messages.reduce((oldest, message) => {
      const timestamp = Number(message.ts);
      if (!Number.isFinite(timestamp)) {
        fail("Slack history contains an invalid message timestamp.", {
          errorCode: "slack_report_reconciliation_incomplete",
          statusCode: 424,
        });
      }
      return Math.min(oldest, timestamp);
    }, Number.POSITIVE_INFINITY);
    if (!result.has_more || oldestTs <= earliestRelevantTs) return null;
    if (!result.next_cursor || result.next_cursor === cursor) {
      fail("Slack history pagination did not advance.", {
        errorCode: "slack_report_reconciliation_incomplete",
        statusCode: 424,
      });
    }
    cursor = result.next_cursor;
  }
  fail("Slack history did not cover the full report attempt window.", {
    errorCode: "slack_report_reconciliation_incomplete",
    statusCode: 424,
  });
}

export default defineAction({
  description:
    "Post one grouped Slack report for eligible GitHub issue or Sentry findings from the current Factory automation run to #qa-agent-native. This action never creates, comments on, or reacts to GitHub issues. Use it once for the complete eligible batch; record non-eligible items with dispatch-factory-item.",
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
    const requestedFindings = findings.map((finding) => {
      const item = itemById.get(finding.itemId);
      if (!item) {
        fail("A Factory finding was not found.", {
          errorCode: "factory_finding_not_found",
          statusCode: 404,
        });
      }
      return { ...finding, ...item };
    });
    const channelId = QA_AGENT_NATIVE_SLACK_CHANNEL_ID;
    const workspace = "primary";
    const slack = createSlackReader({ ownerEmail: userEmail, orgId });
    await slack.getAgentNativeIdentity(workspace);

    const claim = await db.transaction(async (tx) => {
      const currentItems = await tx
        .select()
        .from(triageItems)
        .where(
          and(
            orgFactoryItemFilter(orgId, factoryId),
            inArray(triageItems.id, itemIds),
          ),
        )
        .orderBy(asc(triageItems.id))
        .for("update");
      if (currentItems.length !== requestedFindings.length) {
        fail(
          "One or more findings changed or disappeared before the Slack report could be claimed.",
          { errorCode: "factory_finding_not_found", statusCode: 404 },
        );
      }
      const currentById = new Map(currentItems.map((item) => [item.id, item]));
      const orderedFindings = requestedFindings
        .map((finding) => {
          const current = currentById.get(finding.id);
          if (!current) {
            fail("A Factory finding disappeared before it could be reported.", {
              errorCode: "factory_finding_not_found",
              statusCode: 404,
            });
          }
          return { ...finding, metadataJson: current.metadataJson };
        })
        .filter((finding) => {
          const metadata = parseTriageMetadata(finding.metadataJson);
          return !(
            metadataString(metadata, "slackFindingReportedTs") &&
            metadataString(metadata, "slackFindingReportedChannelId")
          );
        });
      if (orderedFindings.length === 0) {
        return {
          kind: "already_reported" as const,
          count: requestedFindings.length,
          slackMessageTs: null,
        };
      }

      const reportItemIds = orderedFindings.map(({ id }) => id);
      let reportKey = factoryFindingsReportKey({
        orgId,
        factoryId,
        source,
        itemIds: reportItemIds,
      });
      let existingRuns = await tx
        .select()
        .from(triageRuns)
        .where(
          and(
            orgFactoryRunFilter(orgId, factoryId),
            eq(triageRuns.dedupeKey, reportKey),
          ),
        );
      const overlappingPendingRuns = await tx
        .select({ itemId: triageRuns.itemId, dedupeKey: triageRuns.dedupeKey })
        .from(triageRuns)
        .where(
          and(
            orgFactoryRunFilter(orgId, factoryId),
            eq(triageRuns.provider, "slack-findings"),
            eq(triageRuns.status, "submitted"),
            inArray(triageRuns.itemId, reportItemIds),
          ),
        );
      if (overlappingPendingRuns.some((run) => run.dedupeKey !== reportKey)) {
        const priorKeys = [
          ...new Set(overlappingPendingRuns.map(({ dedupeKey }) => dedupeKey)),
        ];
        const priorRuns =
          priorKeys.length === 1
            ? await tx
                .select()
                .from(triageRuns)
                .where(
                  and(
                    orgFactoryRunFilter(orgId, factoryId),
                    eq(triageRuns.dedupeKey, priorKeys[0]!),
                  ),
                )
            : [];
        const priorItemIds = priorRuns.map(({ itemId }) => itemId).sort();
        const requestedItemIds = [...reportItemIds].sort();
        if (
          priorRuns.length === 0 ||
          priorItemIds.length !== requestedItemIds.length ||
          priorItemIds.some((id, index) => id !== requestedItemIds[index])
        ) {
          fail(
            "A different Slack findings report is unresolved for one or more of these items; refusing to post a possible duplicate.",
            { errorCode: "slack_report_pending", statusCode: 409 },
          );
        }
        // Older reports used the automation run id as their dedupe key.
        reportKey = priorKeys[0]!;
        existingRuns = priorRuns;
      }

      if (existingRuns.length > 0) {
        const existingItemIds = existingRuns.map(({ itemId }) => itemId).sort();
        const requestedItemIds = [...reportItemIds].sort();
        if (
          existingItemIds.length !== requestedItemIds.length ||
          existingItemIds.some((id, index) => id !== requestedItemIds[index])
        ) {
          fail(
            "A previous Slack report contains a different findings batch; refusing to split it into extra Slack messages.",
            { errorCode: "factory_report_conflict", statusCode: 409 },
          );
        }
        if (existingRuns.every((run) => run.status === "acknowledged")) {
          return {
            kind: "already_reported" as const,
            count: orderedFindings.length,
            slackMessageTs: existingRuns[0]?.providerTaskId ?? null,
          };
        }
      }

      const nowMs = Date.now();
      const rateLimitedRuns = await tx
        .select()
        .from(triageRuns)
        .where(
          and(
            eq(triageRuns.orgId, orgId),
            eq(triageRuns.provider, "slack-findings"),
            eq(triageRuns.status, "failed"),
            like(triageRuns.error, "slack-rejected: retry-after=%"),
          ),
        )
        .orderBy(desc(triageRuns.completedAt))
        .limit(100);
      if (rateLimitedRuns.some((run) => isSlackRateLimitWaiting(run, nowMs))) {
        fail(
          "Slack rate limited this findings destination; the report will retry after Retry-After.",
          { errorCode: "slack_rate_limited", statusCode: 429 },
        );
      }

      const safelyRetryable =
        existingRuns.length > 0 &&
        existingRuns.every((run) => isSlackReportRejectionRetryable(run));
      const now = new Date().toISOString();
      const runIds = new Map(
        reportItemIds.map((itemId) => [
          itemId,
          existingRuns.find((run) => run.itemId === itemId)?.id ??
            stableId("factory-findings-run", reportKey, itemId),
        ]),
      );
      if (existingRuns.length > 0) {
        if (safelyRetryable) {
          for (const item of orderedFindings) {
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
                  eq(triageRuns.id, runIds.get(item.id)!),
                  eq(triageRuns.orgId, orgId),
                  factoryStillPresent(
                    tx as unknown as typeof db,
                    orgId,
                    factoryId,
                  ),
                ),
              );
          }
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
      return {
        kind: "claimed" as const,
        reportKey,
        orderedFindings,
        reportItemIds,
        runIds,
        existingRuns,
        safelyRetryable,
        startedAt: existingRuns[0]?.startedAt ?? now,
      };
    });
    if (claim.kind === "already_reported") {
      return {
        ok: true,
        posted: false,
        deduplicated: true,
        count: claim.count,
        slackMessageTs: claim.slackMessageTs,
      };
    }
    const {
      reportKey,
      orderedFindings,
      reportItemIds,
      runIds,
      existingRuns,
      safelyRetryable,
      startedAt,
    } = claim;

    let reconciledPost: SlackPostMessageResult | null = null;
    if (existingRuns.length > 0) {
      if (!safelyRetryable) {
        let found: SlackPostMessageResult | null;
        try {
          found = await findSlackReportMessage({
            readHistory: (cursor) =>
              slack.getChannelHistory(workspace, channelId, 100, cursor),
            channelId,
            marker: `Report reference: ${reportKey}`,
            startedAt: existingRuns[0]!.startedAt,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          fail(
            `Could not reconcile the previous Slack delivery attempt: ${message}. The report remains pending and will not be reposted automatically.`,
            {
              errorCode: "slack_report_reconciliation_incomplete",
              statusCode: 424,
            },
          );
        }
        if (!found) {
          fail(
            "The previous Slack delivery attempt is still unresolved; refusing to post a possible duplicate.",
            { errorCode: "slack_report_pending", statusCode: 409 },
          );
        }
        reconciledPost = found;
      }
    }

    let posted: SlackPostMessageResult;
    if (reconciledPost) {
      posted = reconciledPost;
    } else {
      try {
        posted = await slack.postChannelMessage(
          workspace,
          channelId,
          factoryFindingRollupText({
            factoryId,
            reportKey,
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
        const definitelyRejected =
          error instanceof SlackWriteError && error.delivery === "rejected";
        const retryAfterSeconds =
          definitelyRejected && error instanceof SlackWriteError
            ? error.retryAfterSeconds
            : null;
        const rejectionMarker =
          retryAfterSeconds === null
            ? "slack-rejected:"
            : `slack-rejected: retry-after=${retryAfterSeconds}:`;
        await db
          .update(triageRuns)
          .set({
            status: definitelyRejected ? "failed" : "submitted",
            error: `${definitelyRejected ? rejectionMarker : "slack-delivery-unknown:"} ${message}`,
            completedAt: definitelyRejected ? new Date().toISOString() : null,
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
        fail(
          definitelyRejected
            ? `Factory Slack findings report was rejected: ${message}`
            : `Factory Slack findings delivery is unknown: ${message}. The report is pending reconciliation and will not be reposted automatically.`,
          {
            errorCode: definitelyRejected
              ? "slack_findings_report_rejected"
              : "slack_findings_report_delivery_unknown",
            statusCode: 424,
          },
        );
      }
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
              status: "needs_manual",
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
                  at: startedAt,
                  state: "submitted",
                  reason: "Preparing grouped Slack report.",
                },
                {
                  at: acknowledgedAt,
                  state: "acknowledged",
                  reason: `Reported in #qa-agent-native (${posted.channel}).`,
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
            reportKey,
          );
          await tx
            .insert(triageDecisions)
            .values({
              id: decisionId,
              itemId: item.id,
              ruleId: null,
              mode: "automation",
              outcome: "needs_manual",
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
                outcome: "needs_manual",
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
            summary: "Reported this finding in #qa-agent-native.",
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
      count: reportItemIds.length,
      slackChannelId: posted.channel,
      slackMessageTs: posted.ts,
      itemIds: reportItemIds,
    };
  },
});
