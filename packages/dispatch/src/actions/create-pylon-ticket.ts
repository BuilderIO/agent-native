import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { recordAudit } from "../server/lib/dispatch-store.js";

const PYLON_API_BASE =
  process.env.PYLON_API_BASE_URL || "https://api.usepylon.com";

export default defineAction({
  description:
    "Create a Pylon ticket. Use to escalate blockers from client meetings, route unmatched #customer-* posts that have no Slack channel, or open a follow-up that needs tracking. Requires PYLON_API_KEY in the Vault.",
  schema: z.object({
    title: z.string().min(1).describe("Short ticket title"),
    bodyHtml: z
      .string()
      .min(1)
      .describe("HTML body — Pylon renders this in the ticket"),
    requesterEmail: z
      .string()
      .email()
      .optional()
      .describe("Email of the person the ticket is on behalf of"),
    requesterName: z.string().optional(),
    accountId: z
      .string()
      .optional()
      .describe(
        "Pylon account ID — provide either this OR requesterEmail to identify the subject",
      ),
    priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
    tags: z.array(z.string()).optional(),
    assigneeId: z.string().optional(),
    teamId: z.string().optional(),
  }),
  run: async (input) => {
    const apiKey = process.env.PYLON_API_KEY;
    if (!apiKey) {
      throw new Error(
        "PYLON_API_KEY is not set. Add it to the Dispatch Vault.",
      );
    }
    if (!input.accountId && !input.requesterEmail) {
      throw new Error(
        "Pylon requires either accountId or requesterEmail to identify the ticket subject.",
      );
    }

    const payload: Record<string, unknown> = {
      title: input.title,
      body_html: input.bodyHtml,
    };
    if (input.accountId) payload.account_id = input.accountId;
    if (input.requesterEmail) payload.requester_email = input.requesterEmail;
    if (input.requesterName) payload.requester_name = input.requesterName;
    if (input.priority) payload.priority = input.priority;
    if (input.tags?.length) payload.tags = input.tags;
    if (input.assigneeId) payload.assignee_id = input.assigneeId;
    if (input.teamId) payload.team_id = input.teamId;

    const res = await fetch(`${PYLON_API_BASE}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Pylon ticket creation failed (HTTP ${res.status})${text ? `: ${text.slice(0, 500)}` : ""}`,
      );
    }

    const data = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const issue =
      data && typeof data === "object" && "issue" in data
        ? ((data as { issue?: Record<string, unknown> }).issue ?? {})
        : (data ?? {});
    const ticketId =
      issue && typeof (issue as { id?: unknown }).id === "string"
        ? (issue as { id: string }).id
        : "";

    await recordAudit({
      action: "pylon.ticket.created",
      targetType: "pylon-ticket",
      targetId: ticketId || null,
      summary: `Created Pylon ticket: ${input.title}`,
      metadata: {
        title: input.title,
        priority: input.priority,
        tags: input.tags,
        accountId: input.accountId,
        requesterEmail: input.requesterEmail,
        ticketId,
      },
    });

    return {
      ok: true as const,
      ticketId,
      ticket: issue,
    };
  },
});
