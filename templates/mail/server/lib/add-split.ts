import { fail } from "@agent-native/core/action";

import {
  aiFilterRuleMode,
  normalizedAiFilterLabelId,
} from "../../shared/ai-filter-rules.js";
import { withHumanAuthorClause } from "../../shared/human-author.js";
import type { AutomationRule } from "../../shared/types.js";
import {
  processMailAiFilterBackfills,
  readMailAiFilterBackfill,
  startMailAiFilterBackfill,
} from "./ai-filter-backfill.js";
import { createAutomationRule, listAutomationRules } from "./automations.js";

const INLINE_BACKFILL_BUDGET_MS = 20_000;

export type SplitBackfillResult =
  | { status: "skipped" }
  | { status: "queued" | "running" | "completed"; runId: string }
  | { status: "failed"; runId?: string; errorCode: string; error: string };

export type AddSplitResult = {
  created: boolean;
  rule: AutomationRule;
  backfill: SplitBackfillResult;
  appView: { route: string };
};

function existingSplit(
  rules: AutomationRule[],
  name: string,
): AutomationRule | undefined {
  const id = normalizedAiFilterLabelId(name);
  return rules.find((rule) => {
    if (rule.domain !== "mail" || rule.kind !== "ai-filter") return false;
    if (aiFilterRuleMode(rule) !== "tag") return false;
    const label = rule.actions.find((action) => action.type === "label");
    return (
      label?.type === "label" &&
      normalizedAiFilterLabelId(label.labelName) === id
    );
  });
}

async function runBackfill(
  ownerEmail: string,
  ruleId: string,
): Promise<SplitBackfillResult> {
  let runId: string | undefined;
  try {
    ({ runId } = await startMailAiFilterBackfill(ownerEmail, [ruleId]));
    await processMailAiFilterBackfills(
      ownerEmail,
      runId,
      Date.now() + INLINE_BACKFILL_BUDGET_MS,
    );
    const status = await readMailAiFilterBackfill(ownerEmail, runId);
    if (status.status === "failed") {
      return {
        status: "failed",
        runId,
        errorCode: "backfill_failed",
        error: status.error ?? "The backfill failed.",
      };
    }
    if (status.status === "queued" || status.status === "running") {
      return { status: status.status, runId };
    }
    return { status: "completed", runId };
  } catch (error) {
    const code =
      error instanceof Error
        ? (error as Error & { errorCode?: unknown }).errorCode
        : undefined;
    return {
      status: "failed",
      ...(runId ? { runId } : {}),
      errorCode: typeof code === "string" ? code : "backfill_error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function addSplit(
  ownerEmail: string,
  input: { name: string; condition: string; backfill?: boolean },
): Promise<AddSplitResult> {
  const name = input.name.trim();
  if (!name || !input.condition.trim()) {
    fail("A split needs a name and a condition.", {
      errorCode: "invalid_split",
      statusCode: 400,
    });
  }
  const appView = {
    route: `/inbox?split=${encodeURIComponent(normalizedAiFilterLabelId(name))}`,
  };
  const existing = existingSplit(await listAutomationRules(ownerEmail), name);
  if (existing) {
    return {
      created: false,
      rule: existing,
      backfill: { status: "skipped" },
      appView,
    };
  }
  const rule = await createAutomationRule(ownerEmail, {
    name,
    condition: withHumanAuthorClause(input.condition),
    actions: [{ type: "label", labelName: name }],
    domain: "mail",
    kind: "ai-filter",
  });
  const backfill =
    input.backfill === false
      ? ({ status: "skipped" } as const)
      : await runBackfill(ownerEmail, rule.id);
  return {
    created: true,
    rule,
    backfill,
    appView,
  };
}
