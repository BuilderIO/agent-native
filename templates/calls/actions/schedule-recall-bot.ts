import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  resolveDefaultWorkspaceId,
} from "../server/lib/calls.js";
import { resolveRecallApiKey } from "../server/lib/recall.js";
import { writeAppState } from "@agent-native/core/application-state";

function getPublicUrl(): string {
  const url =
    (typeof process !== "undefined" &&
      (process.env.NITRO_PUBLIC_URL || process.env.PUBLIC_URL)) ||
    "";
  return url.replace(/\/$/, "");
}

export default defineAction({
  description:
    "Schedule a Recall.ai bot to join and record a Zoom/Meet/Teams meeting. Inserts a recall_bots row and returns the bot id + status. Requires the RECALL_AI_API_KEY secret.",
  schema: z.object({
    meetingUrl: z
      .string()
      .min(1)
      .describe("Meeting URL (Zoom, Google Meet, or Microsoft Teams link)"),
    scheduledAt: z
      .string()
      .optional()
      .describe("ISO timestamp when the bot should join (optional)"),
    botName: z
      .string()
      .optional()
      .describe(
        "Display name the bot uses when joining (defaults to 'Notes Bot')",
      ),
    workspaceId: z
      .string()
      .optional()
      .describe("Workspace id (defaults to the user's current workspace)"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const apiKey = await resolveRecallApiKey();
    if (!apiKey) {
      throw new Error(
        "RECALL_AI_API_KEY is not configured for this user or workspace. Add it via the onboarding secrets flow.",
      );
    }

    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const workspaceId = args.workspaceId || (await resolveDefaultWorkspaceId());
    const publicUrl = getPublicUrl();

    const body: Record<string, unknown> = {
      meeting_url: args.meetingUrl,
      bot_name: args.botName ?? "Notes Bot",
    };
    if (args.scheduledAt) body.join_at = args.scheduledAt;
    if (publicUrl) {
      body.webhook_url = `${publicUrl}/api/webhooks/recall`;
    }

    let raw: any = {};
    let externalId: string | undefined;
    let status: "scheduled" | "joining" | "recording" | "failed" = "scheduled";
    let failureReason: string | undefined;

    try {
      const res = await fetch("https://api.recall.ai/api/v1/bot", {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      raw = await res.json().catch(() => ({}));
      if (!res.ok) {
        status = "failed";
        failureReason =
          (raw && typeof raw === "object" && (raw.detail || raw.error)) ||
          `Recall.ai responded with ${res.status}`;
      } else {
        externalId =
          typeof raw?.id === "string"
            ? raw.id
            : typeof raw?.bot_id === "string"
              ? raw.bot_id
              : undefined;
        const recallStatus =
          typeof raw?.status_changes?.[0]?.code === "string"
            ? raw.status_changes[0].code
            : typeof raw?.status === "string"
              ? raw.status
              : undefined;
        if (
          recallStatus === "joining_call" ||
          recallStatus === "in_call_not_recording"
        ) {
          status = "joining";
        } else if (recallStatus === "in_call_recording") {
          status = "recording";
        }
      }
    } catch (err) {
      status = "failed";
      failureReason = err instanceof Error ? err.message : String(err);
    }

    const id = externalId || nanoid();
    const now = new Date().toISOString();

    await db.insert(schema.recallBots).values({
      id,
      callId: null,
      workspaceId,
      meetingUrl: args.meetingUrl,
      status,
      scheduledAt: args.scheduledAt ?? null,
      startedAt: null,
      endedAt: null,
      createdBy: ownerEmail,
      rawJson: JSON.stringify({ ...raw, failureReason }),
      createdAt: now,
      updatedAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      botId: id,
      status,
      meetingUrl: args.meetingUrl,
      scheduledAt: args.scheduledAt ?? null,
      failureReason: failureReason ?? null,
    };
  },
});
