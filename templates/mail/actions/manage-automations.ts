import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { AutomationAction } from "../shared/types.js";

export const createManageEmailRulesAction = (agentTool: boolean) =>
  defineAction({
    description:
      "Create, list, update, or delete email automation rules. Rules are processed automatically against new inbox emails using AI.",
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
        .describe(
          'Natural language condition, e.g. "from a newsletter" or "subject contains invoice"',
        ),
      actions: z
        .string()
        .optional()
        .describe(
          'JSON array of actions, e.g. [{"type":"label","labelName":"newsletters"}]. Action types: label, archive, mark_read, star, trash',
        ),
      enabled: z.coerce
        .boolean()
        .optional()
        .describe("Whether the rule is enabled"),
    }),
    run: async (args) => {
      const { action } = args;

      // Lazy-import DB to avoid issues when running outside server context
      const { db, schema } = await import("../server/db/index.js");

      const ownerEmail = getRequestUserEmail();
      if (!ownerEmail) throw new Error("no authenticated user");

      switch (action) {
        case "list": {
          const rules = await db
            .select()
            .from(schema.automationRules)
            .where(eq(schema.automationRules.ownerEmail, ownerEmail));

          if (rules.length === 0) {
            return "No automation rules configured. Create one with --action=create.";
          }

          return rules
            .map((r: any) => {
              const actions = JSON.parse(r.actions);
              const actionStr = actions
                .map((a: any) =>
                  a.type === "label" ? `label:"${a.labelName}"` : a.type,
                )
                .join(", ");
              return `[${r.id}] ${r.enabled ? "✓" : "✗"} "${r.name}" — ${r.condition} → ${actionStr}`;
            })
            .join("\n");
        }

        case "create": {
          if (!args.name || !args.condition || !args.actions) {
            throw new Error(
              "--name, --condition, and --actions are required for create",
            );
          }

          let actions;
          try {
            actions = JSON.parse(args.actions);
          } catch {
            throw new Error("--actions must be valid JSON array");
          }

          const now = Math.floor(Date.now() / 1_000);
          const rule = {
            id: nanoid(12),
            ownerEmail,
            domain: "mail",
            name: args.name,
            condition: args.condition,
            actions: JSON.stringify(actions),
            enabled: 1,
            createdAt: now,
            updatedAt: now,
          };

          await db.insert(schema.automationRules).values(rule as any);
          return `Created automation rule "${args.name}" (${rule.id})`;
        }

        case "update": {
          if (!args.id) throw new Error("--id is required for update");

          const patch: {
            name?: string;
            condition?: string;
            actions?: AutomationAction[];
            enabled?: boolean;
          } = {};
          if (args.name !== undefined) patch.name = args.name;
          if (args.condition !== undefined) patch.condition = args.condition;
          if (args.actions !== undefined) {
            try {
              patch.actions = JSON.parse(args.actions);
            } catch {
              throw new Error("--actions must be valid JSON array");
            }
          }
          if (args.enabled !== undefined) patch.enabled = args.enabled;

          const { updateAutomationRule } =
            await import("../server/lib/automations.js");
          await updateAutomationRule(ownerEmail, args.id, patch);

          return `Updated automation rule ${args.id}`;
        }

        case "delete": {
          if (!args.id) throw new Error("--id is required for delete");

          await db
            .delete(schema.automationRules)
            .where(
              and(
                eq(schema.automationRules.id, args.id),
                eq(schema.automationRules.ownerEmail, ownerEmail),
              ),
            );

          return `Deleted automation rule ${args.id}`;
        }

        case "enable": {
          if (!args.id) throw new Error("--id is required for enable");
          const { updateAutomationRule } =
            await import("../server/lib/automations.js");
          await updateAutomationRule(ownerEmail, args.id, { enabled: true });

          return `Enabled automation rule ${args.id}`;
        }

        case "disable": {
          if (!args.id) throw new Error("--id is required for disable");
          const { updateAutomationRule } =
            await import("../server/lib/automations.js");
          await updateAutomationRule(ownerEmail, args.id, { enabled: false });

          return `Disabled automation rule ${args.id}`;
        }

        default:
          throw new Error(
            `Unknown action "${action}". Use: list, create, update, delete, enable, disable`,
          );
      }
    },
  });

export default createManageEmailRulesAction(false);
