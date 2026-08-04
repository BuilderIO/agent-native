import { getRequestUserEmail } from "@agent-native/core/server";
import { and, desc, eq } from "drizzle-orm";

import { db, schema } from "../db/index.js";

export const DEFAULT_AUTOMATION_SLUG = "daily-digest";

export const DEFAULT_AUTOMATION = {
  id: null,
  slug: DEFAULT_AUTOMATION_SLUG,
  name: "Daily workspace digest",
  schedule: "Weekdays at 9:00 AM",
  recipient: "you@example.com",
  prompt:
    "Summarize the most important workspace updates from the last day. Include a short overview, three useful highlights, and anything that needs my attention.",
  updatedAt: null,
  persisted: false,
} as const;

export function requireOwnerEmail() {
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) throw new Error("An authenticated user is required.");
  return ownerEmail;
}

export async function findAutomation(ownerEmail: string, id?: string | null) {
  const filters = id
    ? and(
        eq(schema.emailAutomations.id, id),
        eq(schema.emailAutomations.ownerEmail, ownerEmail),
      )
    : and(
        eq(schema.emailAutomations.slug, DEFAULT_AUTOMATION_SLUG),
        eq(schema.emailAutomations.ownerEmail, ownerEmail),
      );

  const rows = await db()
    .select()
    .from(schema.emailAutomations)
    .where(filters)
    .limit(1);
  return rows[0] ?? null;
}

export async function listRuns(ownerEmail: string) {
  return db()
    .select()
    .from(schema.emailAutomationRuns)
    .where(eq(schema.emailAutomationRuns.ownerEmail, ownerEmail))
    .orderBy(desc(schema.emailAutomationRuns.createdAt))
    .limit(12);
}

export function automationResponse(
  automation: typeof schema.emailAutomations.$inferSelect | null,
) {
  if (!automation) return DEFAULT_AUTOMATION;
  return {
    id: automation.id,
    slug: automation.slug,
    name: automation.name,
    schedule: automation.schedule,
    recipient: automation.recipient,
    prompt: automation.prompt,
    updatedAt: automation.updatedAt,
    persisted: true,
  };
}

export function parsePreviewItems(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
    ) {
      return parsed;
    }
  } catch {
    // A malformed preview should be visible as a failure, not treated as empty.
  }
  throw new Error("The saved email preview could not be read.");
}

export function runResponse(
  run: typeof schema.emailAutomationRuns.$inferSelect,
) {
  return {
    id: run.id,
    automationId: run.automationId,
    recipient: run.recipient,
    status: run.status,
    stage: run.stage,
    errorMessage: run.errorMessage,
    subject: run.subject,
    previewIntro: run.previewIntro,
    previewItems: parsePreviewItems(run.previewItems),
    promptSnapshot: run.promptSnapshot,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    delivery: "preview_only" as const,
  };
}

export function buildPreview(prompt: string) {
  const focus = prompt.replace(/\s+/g, " ").trim().slice(0, 140);
  return {
    subject: "Your daily workspace digest",
    intro: focus
      ? `A concise digest prepared from: ${focus}`
      : "A concise digest prepared from your workspace updates.",
    items: [
      "3 updates are ready for review",
      "2 automation runs completed successfully",
      "Nothing urgent needs your attention",
    ],
  };
}
