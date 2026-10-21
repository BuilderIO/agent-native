import { z } from "zod";

import { defineAction } from "../../action.js";
import { getDbExec } from "../../db/client.js";

export interface AutomationAccountSearchResult {
  email: string;
  name: string | null;
  avatar: string | null;
  outsideOrganization: boolean;
}

export default defineAction({
  description:
    "Search existing accounts for the automation sharing picker. This action never creates or invites accounts.",
  agentTool: false,
  schema: z.object({
    query: z.string().trim().min(2).max(100),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async (
    { query, limit },
    ctx,
  ): Promise<AutomationAccountSearchResult[]> => {
    if (!ctx?.userEmail) {
      throw Object.assign(new Error("Not authenticated."), { statusCode: 401 });
    }

    const term = `%${query.trim().toLowerCase()}%`;
    const accounts = await getDbExec().execute({
      sql: `SELECT email, name, image FROM "user" WHERE LOWER(email) LIKE ? OR LOWER(name) LIKE ? ORDER BY LOWER(email) LIMIT ?`,
      args: [term, term, limit],
    });
    const emails = accounts.rows.map((row) =>
      String(row.email ?? "")
        .trim()
        .toLowerCase(),
    );
    const memberEmails = new Set<string>();
    if (ctx.orgId && emails.length) {
      const memberships = await getDbExec().execute({
        sql: `SELECT LOWER(email) AS email FROM org_members WHERE org_id = ? AND LOWER(email) IN (${emails.map(() => "?").join(", ")})`,
        args: [ctx.orgId, ...emails],
      });
      for (const row of memberships.rows) {
        memberEmails.add(
          String(row.email ?? "")
            .trim()
            .toLowerCase(),
        );
      }
    }

    return accounts.rows.map((row) => {
      const email = String(row.email ?? "")
        .trim()
        .toLowerCase();
      const name = String(row.name ?? "").trim();
      const avatar = String(row.image ?? "").trim();
      return {
        email,
        name: name || null,
        avatar: avatar || null,
        outsideOrganization: !ctx.orgId || !memberEmails.has(email),
      };
    });
  },
});
