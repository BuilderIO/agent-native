import { AI_FILTER_LABEL } from "./ai-filter.js";
import { AI_IMPORTANT_LABEL } from "./ai-priority.js";
import type { AutomationRule } from "./types.js";

export type AiFilterRuleMode = "important" | "tag" | "filtered" | "archive";

export function aiFilterRuleMode(
  rule: Pick<AutomationRule, "actions">,
): AiFilterRuleMode | null {
  if (
    rule.actions.some(
      (action) =>
        action.type === "label" && action.labelName === AI_FILTER_LABEL,
    )
  ) {
    return "filtered";
  }
  if (
    rule.actions.some(
      (action) =>
        action.type === "label" && action.labelName === AI_IMPORTANT_LABEL,
    )
  ) {
    return "important";
  }
  if (rule.actions.some((action) => action.type === "archive")) {
    return "archive";
  }
  return rule.actions.some((action) => action.type === "label") ? "tag" : null;
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
