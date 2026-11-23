import { defineAction } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import { z } from "zod";

/**
 * Where a finished run can be delivered.
 *
 * The source's task dialog lets an owner send a run's summary to people, groups
 * or a Slack channel (taskModal/TaskNotificationSection.tsx). Those three come
 * from the workspace's own data - the org roster, the org's user groups, and the
 * workspace connection catalog - so this action reports what actually exists
 * here. A kind with no rows is simply absent: the dialog only offers what this
 * workspace can deliver to, and the framework's delivery adapters are what
 * actually send.
 */
export type TaskDestinationKind = "user" | "group" | "slack";

export interface TaskDestination {
  kind: TaskDestinationKind;
  /** Stable id stored on the automation (`deliveryDestination`). */
  id: string;
  label: string;
  /** How the run reaches it; also the automation's `deliveryPlatform`. */
  platform: string;
}

async function rows(
  sql: string,
  args: Array<string | number | null> = [],
): Promise<Array<Record<string, unknown>>> {
  try {
    const result = await getDbExec().execute({ sql, args });
    return result.rows as Array<Record<string, unknown>>;
  } catch {
    // A workspace without the table (or without these rows) offers nothing of
    // that kind; that is an empty list, not a broken dialog.
    return [];
  }
}

export async function collectTaskDestinations(ctx?: {
  userEmail?: string;
  orgId?: string;
}): Promise<TaskDestination[]> {
  const out: TaskDestination[] = [];
  const seen = new Set<string>();
  const add = (destination: TaskDestination) => {
    const key = `${destination.kind}:${destination.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(destination);
  };

  if (ctx?.orgId) {
    const members = await rows(
      `SELECT DISTINCT LOWER(m.email) AS email, u.name AS name
         FROM org_members m
         LEFT JOIN "user" u ON LOWER(u.email) = LOWER(m.email)
        WHERE m.org_id = ? AND m.federation_removal_pending_at IS NULL
        ORDER BY LOWER(m.email)`,
      [ctx.orgId],
    );
    for (const member of members) {
      const email = String(member.email ?? "").trim();
      if (!email) continue;
      add({
        kind: "user",
        id: email,
        label: String(member.name ?? "").trim() || email,
        platform: "email",
      });
    }

    const groups = await rows(
      `SELECT id, name, member_emails_json FROM workspace_user_groups WHERE org_id = ? ORDER BY LOWER(name)`,
      [ctx.orgId],
    );
    for (const group of groups) {
      const id = String(group.id ?? "").trim();
      const name = String(group.name ?? "").trim();
      if (!id || !name) continue;
      let members: string[] = [];
      try {
        members = JSON.parse(String(group.member_emails_json ?? "[]"));
      } catch {
        members = [];
      }
      if (!Array.isArray(members) || members.length === 0) continue;
      add({ kind: "group", id, label: name, platform: "email" });
    }

    const connections = await rows(
      `SELECT id, provider, label, status FROM workspace_connections
        WHERE org_id = ? AND provider LIKE '%slack%' AND status = 'connected'
        ORDER BY LOWER(label)`,
      [ctx.orgId],
    );
    for (const connection of connections) {
      const id = String(connection.id ?? "").trim();
      if (!id) continue;
      add({
        kind: "slack",
        id,
        label: String(connection.label ?? "").trim() || "Slack",
        platform: "slack",
      });
    }
  }

  return out;
}

export default defineAction({
  description:
    "List the destinations a scheduled task's run can be delivered to in this workspace: people, groups and connected Slack workspaces.",
  agentTool: true,
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async (_input, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    return collectTaskDestinations({
      userEmail: ctx.userEmail,
      ...(ctx.orgId ? { orgId: ctx.orgId } : {}),
    });
  },
});
