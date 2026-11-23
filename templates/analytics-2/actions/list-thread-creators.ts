import { defineAction } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import { z } from "zod";

import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";

const MAX_CREATORS = 100;

const rowSchema = z.object({
  email: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
});

function httpsUrl(value: string | null): string | null {
  const url = value?.trim();
  return url?.startsWith("https://") ? url : null;
}

export default defineAction({
  description:
    "Read the display name and avatar of thread creators who are active members of the current workspace, in one batched read. A creator outside the workspace is omitted, never guessed.",
  schema: z
    .object({
      ownerEmails: z.array(z.string().min(1)).min(1).max(MAX_CREATORS),
    })
    .strict(),
  outputSchema: z.object({
    creators: z.array(
      z.object({
        email: z.string(),
        name: z.string().nullable(),
        imageUrl: z.string().nullable(),
      }),
    ),
  }),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async ({ ownerEmails }) => {
    const current = await requireCurrentWorkspace();
    const emails = [
      ...new Set(ownerEmails.map((email) => email.trim().toLowerCase())),
    ];
    const marks = emails.map(() => "?").join(", ");
    const result = await getDbExec().execute({
      sql: `SELECT m.email AS email, u.name AS name, u.image AS image
            FROM org_members m
            LEFT JOIN "user" u ON LOWER(u.email) = LOWER(m.email)
            WHERE m.org_id = ? AND m.federation_removal_pending_at IS NULL
              AND LOWER(m.email) IN (${marks})`,
      args: [current.orgId, ...emails],
    });
    return {
      creators: result.rows.map((row) => {
        const member = rowSchema.parse(row);
        return {
          email: member.email.toLowerCase(),
          name: member.name?.trim() || null,
          imageUrl: httpsUrl(member.image),
        };
      }),
    };
  },
});
