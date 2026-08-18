import { randomUUID } from "node:crypto";

import { defineAction } from "@agent-native/core/action";
import { classifyAgentFailure } from "@agent-native/core/agent/engine";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import {
  triageDecisions,
  triageItems,
  triageRules,
} from "../server/db/schema.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { recordFactoryAudit } from "../server/triage/audit.js";
import {
  normalizeTriagePolicyGuards,
  triageGuardCodeSchema,
} from "../server/triage/contracts.js";
import { evaluateStructuredGuards } from "../server/triage/guards.js";

export default defineAction({
  description:
    "Triage one Factory item against enabled rules and append structured guard decisions. This records proposals only and never changes a provider.",
  schema: z.object({ itemId: z.string().min(1) }),
  http: { method: "POST" },
  run: async ({ itemId }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const db = getDb();
    const item = (
      await db
        .select()
        .from(triageItems)
        .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)))
        .limit(1)
    )[0];
    if (!item) throw new Error("Triage item not found");

    const rules = await db
      .select()
      .from(triageRules)
      .where(and(eq(triageRules.orgId, orgId), eq(triageRules.enabled, 1)));
    const metadata = parseMetadata(item.metadataJson);
    const evidence = {
      repository: item.repository ?? undefined,
      changedFiles: parseStringArray(metadata.changedFiles),
      diffLines: parseOptionalNumber(metadata.diffLines),
      risk: item.risk,
      categories: parseGuardCategories(metadata.categories),
    };
    const failureTaxonomy = classifyAgentFailure({
      errorCode: metadata.errorCode,
      errorDetail: [item.title, item.summary, metadata.failureText]
        .filter((value): value is string => typeof value === "string")
        .join("\n"),
      terminalReason: metadata.terminalReason,
      terminalEvent: metadata.terminalEvent,
      regime:
        metadata.regime === "scheduled" || metadata.regime === "interactive"
          ? metadata.regime
          : undefined,
    });
    const taxonomyReason =
      failureTaxonomy.code === "unknown"
        ? ""
        : `Observed failure taxonomy: ${failureTaxonomy.label} (${failureTaxonomy.code}; ${failureTaxonomy.regime}). `;

    if (rules.length === 0) {
      await recordFactoryAudit(
        context,
        { userEmail, orgId },
        {
          action: "evaluate-triage-item",
          kind: "decision",
          status: "skipped",
          itemId,
          source: item.source,
          sourceUrl: item.sourceUrl,
          summary: "No enabled shadow rules were available for this item.",
          details: { evaluated: 0 },
        },
      );
      return {
        ok: true,
        itemId,
        evaluated: 0,
        reason: "No enabled shadow rules.",
      };
    }

    const now = new Date().toISOString();
    const decisions = rules.map((rule) => {
      const guards = normalizeTriagePolicyGuards(
        parseObject(JSON.parse(rule.guardsJson), "guards"),
      );
      const guardResults = evaluateStructuredGuards(guards, evidence);
      const outcome = guardResults.every((guard) => guard.passed)
        ? "observe"
        : "needs_manual";
      return {
        id: randomUUID(),
        itemId,
        ruleId: rule.id,
        mode: rule.mode,
        outcome,
        reason:
          taxonomyReason + guardResults.map((guard) => guard.reason).join(" "),
        guardResultsJson: JSON.stringify(guardResults),
        model: "structured-guards+failure-taxonomy",
        promptVersion: rule.promptVersion,
        createdAt: now,
        ownerEmail: userEmail,
        orgId,
      };
    });

    await db.transaction(async (tx) => {
      await tx.insert(triageDecisions).values(decisions);
      await tx
        .update(triageItems)
        .set({
          status: decisions.some(
            (decision) => decision.outcome === "needs_manual",
          )
            ? "needs_manual"
            : "shadow_decided",
          updatedAt: now,
        })
        .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)));
    });

    for (const decision of decisions) {
      await recordFactoryAudit(
        context,
        { userEmail, orgId },
        {
          action: "evaluate-triage-item",
          kind: "decision",
          itemId,
          source: item.source,
          sourceUrl: item.sourceUrl,
          summary: decision.reason,
          details: {
            decisionId: decision.id,
            outcome: decision.outcome,
            ruleId: decision.ruleId,
            mode: decision.mode,
            promptVersion: decision.promptVersion,
          },
        },
      );
    }

    return {
      ok: true,
      itemId,
      evaluated: decisions.length,
      decisionIds: decisions.map((decision) => decision.id),
    };
  },
});

function parseMetadata(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Triage item metadata is unreadable.");
  }
  return parseObject(parsed, "metadata");
}

function parseObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Triage ${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === "string")
  ) {
    throw new Error("Triage changedFiles metadata is unreadable.");
  }
  return value;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Triage diffLines metadata is unreadable.");
  }
  return value;
}

function parseGuardCategories(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value))
    throw new Error("Triage categories metadata is unreadable.");
  return value.map((entry) => triageGuardCodeSchema.parse(entry));
}
