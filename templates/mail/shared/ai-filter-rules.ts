import { AI_FILTER_LABEL } from "./ai-filter.js";
import { AI_IMPORTANT_LABEL } from "./ai-priority.js";
import { normalizeMailLabel } from "./gmail-labels.js";
import type { AutomationAction, AutomationRule } from "./types.js";

export type AiFilterRuleMode = "important" | "tag" | "filtered" | "archive";

export function isReservedAiFilterLabelName(labelName: string): boolean {
  const normalized = normalizeMailLabel(labelName);
  return (
    normalized === normalizeMailLabel(AI_FILTER_LABEL) ||
    normalized === normalizeMailLabel(AI_IMPORTANT_LABEL)
  );
}

export function aiFilterRuleMode(
  rule: Pick<AutomationRule, "actions">,
): AiFilterRuleMode | null {
  const labels = rule.actions.filter(
    (action): action is Extract<AutomationAction, { type: "label" }> =>
      action.type === "label",
  );
  const archives = rule.actions.filter((action) => action.type === "archive");

  if (
    rule.actions.length === 2 &&
    labels.length === 1 &&
    archives.length === 1 &&
    labels[0].labelName === AI_FILTER_LABEL
  ) {
    return "filtered";
  }
  if (
    rule.actions.length === 1 &&
    labels.length === 1 &&
    labels[0].labelName === AI_IMPORTANT_LABEL
  ) {
    return "important";
  }
  if (rule.actions.length === 1 && archives.length === 1) {
    return "archive";
  }
  if (
    labels.length === 1 &&
    archives.length <= 1 &&
    rule.actions.length === labels.length + archives.length &&
    labels[0].labelName.trim() === labels[0].labelName &&
    labels[0].labelName.length > 0 &&
    !isReservedAiFilterLabelName(labels[0].labelName)
  ) {
    return "tag";
  }
  return null;
}

export function aiFilterRuleActionsForMode(
  mode: AiFilterRuleMode,
  tagName = "",
  existingActions: readonly AutomationAction[] = [],
): AutomationAction[] {
  if (mode === "important") {
    return [{ type: "label", labelName: AI_IMPORTANT_LABEL }];
  }
  if (mode === "filtered") {
    return [{ type: "label", labelName: AI_FILTER_LABEL }, { type: "archive" }];
  }
  if (mode === "archive") return [{ type: "archive" }];

  const labelName = tagName.trim();
  if (!labelName || isReservedAiFilterLabelName(labelName)) {
    throw new Error("Choose a custom label name for tag mode");
  }
  return [
    { type: "label", labelName },
    ...(existingActions.some((action) => action.type === "archive")
      ? [{ type: "archive" as const }]
      : []),
  ];
}

export function aiFilterRuleLabelName(
  rule: Pick<AutomationRule, "actions">,
): string {
  const action = rule.actions.find((item) => item.type === "label");
  return action?.type === "label" ? action.labelName : "";
}

export function normalizedAiFilterLabelId(labelName: string): string {
  return labelName.trim().toLocaleLowerCase().replace(/_/g, " ");
}
