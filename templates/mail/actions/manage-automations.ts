import { defineAction } from "@agent-native/core/action";
import { buildDeepLink, getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import {
  aiFilterRuleActionsForMode,
  aiFilterRuleLabelName,
  aiFilterRuleMode,
  type AiFilterRuleMode,
} from "../shared/ai-filter-rules.js";
import { automationActionSchema } from "../shared/automation-schema.js";
import type { AutomationAction, AutomationRule } from "../shared/types.js";

const actionSchema = z.array(automationActionSchema).min(1);

function parseActions(value: string): AutomationAction[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("--actions must be valid JSON array");
  }
  return actionSchema.parse(parsed);
}

function isAiFilterRule(actions: AutomationAction[]): boolean {
  return actions.every(
    (action) => action.type === "label" || action.type === "archive",
  );
}

type AgentRuleMode = "tag" | "important" | "filter" | "archive";

function actionsForAgentMode(
  mode: AgentRuleMode,
  tagName?: string,
  existingActions: readonly AutomationAction[] = [],
): AutomationAction[] {
  if (mode === "tag" && !tagName?.trim()) {
    throw new Error("--tagName is required for tag mode");
  }
  return aiFilterRuleActionsForMode(
    mode === "filter" ? "filtered" : mode,
    tagName,
    existingActions,
  );
}

function ruleNameForMode(mode: AgentRuleMode, sentence: string): string {
  const prefix = mode === "filter" ? "spam" : mode;
  return `AI ${prefix}: ${sentence.slice(0, 72)}`;
}

function agentModeForRule(
  rule: AutomationRule | undefined,
): AgentRuleMode | AiFilterRuleMode | "ai-filter" | "automation" {
  if (!rule || rule.kind !== "ai-filter") return "automation";
  const mode = aiFilterRuleMode(rule);
  return mode === "filtered" ? "filter" : (mode ?? "ai-filter");
}

function settingsHref(kind: string | undefined): string {
  const section = kind === "ai-filter" ? "ai-filter" : "automations";
  return buildDeepLink({
    app: "mail",
    view: "settings",
    to: `/settings?section=${section}`,
  });
}

function ruleResult(
  rule: AutomationRule | undefined,
  operation: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id: rule?.id,
    name: rule?.name,
    mode: agentModeForRule(rule),
    operation,
    sentence: rule?.condition ?? "",
    actions: rule?.actions,
    ...(rule?.kind === "ai-filter" && aiFilterRuleMode(rule) === "tag"
      ? { tagName: aiFilterRuleLabelName(rule) }
      : {}),
    enabled: rule?.enabled ?? false,
    appliedCounts: null,
    settingsHref: settingsHref(rule?.kind),
    ...extra,
  };
}

async function startRecentBackfill(ownerEmail: string, rule: AutomationRule) {
  if (!rule.enabled) return { backfillStatus: "not-started-disabled" };

  let runId: string;
  try {
    const { startMailAiFilterBackfill } =
      await import("../server/lib/ai-filter-backfill.js");
    ({ runId } = await startMailAiFilterBackfill(ownerEmail, [rule.id]));
  } catch {
    return {
      appliedCounts: null,
      backfillStatus: "failed",
      backfillError:
        "The rule was saved, but its recent-mail backfill could not start.",
    };
  }

  try {
    const { readMailAiFilterBackfill } =
      await import("../server/lib/ai-filter-backfill.js");
    const status = await readMailAiFilterBackfill(ownerEmail, runId);
    return {
      appliedCounts:
        status.status === "queued"
          ? null
          : status.perRule.map(({ ruleId, name, appliedCount }) => ({
              ruleId,
              name,
              appliedCount,
            })),
      backfillRunId: runId,
      backfillStatus: status.status,
      ...(status.error ? { backfillError: status.error } : {}),
    };
  } catch {
    return {
      appliedCounts: null,
      backfillRunId: runId,
      backfillStatus: "status-unavailable",
      backfillError:
        "The backfill was queued, but its progress could not be read.",
    };
  }
}

export const createManageEmailRulesAction = (agentTool: boolean) =>
  defineAction({
    description:
      "Create, list, update, or delete inbox rules. For natural-language AI rules, use one sentence and a mode (tag, important, filter, or archive); recent mail is backfilled automatically. Star, mark-read, and trash rules keep the legacy automation behavior.",
    agentTool,
    schema: z.object({
      action: z
        .enum(["list", "create", "update", "delete", "enable", "disable"])
        .optional()
        .describe("Action to perform"),
      id: z
        .string()
        .optional()
        .describe("Rule ID (for update/delete/enable/disable)"),
      name: z.string().optional().describe("Human-readable rule name"),
      condition: z
        .string()
        .optional()
        .describe("Natural-language condition for matching incoming email"),
      mode: z
        .enum(["tag", "important", "filter", "archive"])
        .optional()
        .describe("AI rule mode for a new inbox rule"),
      sentence: z
        .string()
        .trim()
        .min(1)
        .max(1_000)
        .optional()
        .describe("One-sentence description of the mail to match"),
      tagName: z
        .string()
        .trim()
        .min(1)
        .max(128)
        .optional()
        .describe("Label name for a tag-mode rule"),
      actions: z
        .string()
        .optional()
        .describe(
          'JSON array of actions, e.g. [{"type":"label","labelName":"newsletters"}]. Label/archive use Mail AI filtering; use labelName "agent-native-important" for priority rules and "agent-native-filtered" plus archive for unwanted mail. mark_read, star, and trash use legacy automations.',
        ),
      enabled: z.coerce
        .boolean()
        .optional()
        .describe("Whether the rule is enabled"),
    }),
    run: async (args) => {
      const ownerEmail = getRequestUserEmail();
      if (!ownerEmail) throw new Error("no authenticated user");
      const {
        createAutomationRule,
        deleteAutomationRule,
        listAutomationRules,
        updateAutomationRule,
      } = await import("../server/lib/automations.js");

      switch (args.action) {
        case "list": {
          const rules = await listAutomationRules(ownerEmail);
          return {
            mode: "list",
            rules: rules.map((rule) => ruleResult(rule, "list")),
          };
        }

        case "create": {
          let name = args.name;
          let condition = args.sentence ?? args.condition;
          let actions: AutomationAction[];
          if (args.mode) {
            if (!condition)
              throw new Error("--sentence is required for a rule");
            actions = actionsForAgentMode(args.mode, args.tagName);
            name ??= ruleNameForMode(args.mode, condition);
          } else {
            if (!name || !condition || !args.actions) {
              throw new Error(
                "--name, --condition, and --actions are required for create",
              );
            }
            actions = parseActions(args.actions);
          }
          const kind = isAiFilterRule(actions) ? "ai-filter" : "automation";
          const rule = await createAutomationRule(ownerEmail, {
            name: name!,
            condition,
            actions,
            domain: "mail",
            kind,
            enabled: args.enabled,
          });
          const backfill =
            kind === "ai-filter"
              ? await startRecentBackfill(ownerEmail, rule)
              : { backfillStatus: "not-applicable" };
          return ruleResult(rule, "create", backfill);
        }

        case "update": {
          if (!args.id) throw new Error("--id is required for update");

          const existing = (await listAutomationRules(ownerEmail)).find(
            (rule) => rule.id === args.id,
          );
          const patch: {
            name?: string;
            condition?: string;
            actions?: AutomationAction[];
            enabled?: boolean;
            kind?: "automation" | "ai-filter";
          } = {};
          if (args.name !== undefined) patch.name = args.name;
          if (args.mode !== undefined) {
            const sentence =
              args.sentence ?? args.condition ?? existing?.condition;
            if (!sentence) throw new Error("--sentence is required for a rule");
            const tagName =
              args.tagName ??
              (existing ? aiFilterRuleLabelName(existing) : undefined);
            patch.condition = sentence;
            patch.actions = actionsForAgentMode(
              args.mode,
              tagName,
              existing?.actions,
            );
            patch.name ??= ruleNameForMode(args.mode, sentence);
            if (existing?.domain === "mail") patch.kind = "ai-filter";
          } else if (args.condition !== undefined) {
            patch.condition = args.condition;
          }
          if (args.actions !== undefined && args.mode === undefined) {
            patch.actions = parseActions(args.actions);
            if (existing?.domain === "mail") {
              patch.kind = isAiFilterRule(patch.actions)
                ? "ai-filter"
                : "automation";
            }
          }
          if (args.enabled !== undefined) patch.enabled = args.enabled;

          const rule = await updateAutomationRule(ownerEmail, args.id, patch);
          const backfill =
            rule.domain === "mail" && rule.kind === "ai-filter"
              ? await startRecentBackfill(ownerEmail, rule)
              : { backfillStatus: "not-applicable" };
          return ruleResult(rule, "update", backfill);
        }

        case "delete": {
          if (!args.id) throw new Error("--id is required for delete");
          const existing = (await listAutomationRules(ownerEmail)).find(
            (rule) => rule.id === args.id,
          );
          await deleteAutomationRule(ownerEmail, args.id);
          return ruleResult(existing, "delete", {
            id: args.id,
            deleted: Boolean(existing),
            enabled: false,
          });
        }

        case "enable":
        case "disable": {
          if (!args.id) throw new Error(`--id is required for ${args.action}`);
          const rule = await updateAutomationRule(ownerEmail, args.id, {
            enabled: args.action === "enable",
          });
          const backfill =
            args.action === "enable" &&
            rule.domain === "mail" &&
            rule.kind === "ai-filter"
              ? await startRecentBackfill(ownerEmail, rule)
              : { backfillStatus: "not-applicable" };
          return ruleResult(rule, args.action, backfill);
        }

        default:
          throw new Error(
            `Unknown action "${args.action}". Use: list, create, update, delete, enable, disable`,
          );
      }
    },
  });

export default createManageEmailRulesAction(false);
