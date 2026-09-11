/**
 * "Your generation finished" notifications.
 *
 * Only terminal transitions that happen *out of band* call this — a polled video
 * run landing, or a stale image run being declared interrupted. Synchronous
 * `generate-image` hands the result straight back to the caller, so emailing
 * there would mail a user who is already looking at the image.
 */
import { notifyWithDelivery } from "@agent-native/core/notifications";
import { getUserSetting } from "@agent-native/core/settings";

import {
  ASSETS_USER_PREFS_KEY,
  type AssetsUserPrefs,
} from "../../shared/assets-user-prefs.js";
import type { schema } from "../db/index.js";

type GenerationRun = typeof schema.assetGenerationRuns.$inferSelect;

export type GenerationRunNotificationStatus =
  | "no-recipient"
  | "notified"
  | "notification-error";

export interface GenerationRunNotificationResult {
  status: GenerationRunNotificationStatus;
  emailed: boolean;
}

async function wantsEmail(email: string): Promise<boolean> {
  const stored = await getUserSetting(email, ASSETS_USER_PREFS_KEY);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    // No stored preference is a real state, and its meaning is "opted in".
    return true;
  }
  return (stored as AssetsUserPrefs).emailNotifications !== false;
}

function summarize(run: GenerationRun): string {
  const kind = run.mediaType === "video" ? "Video" : "Image";
  const prompt = run.prompt.trim();
  return prompt.length > 80
    ? `${kind}: ${prompt.slice(0, 77)}…`
    : `${kind}: ${prompt}`;
}

export async function notifyGenerationRunFinished(
  run: GenerationRun,
  outcome: "completed" | "failed",
): Promise<GenerationRunNotificationResult> {
  const owner = run.ownerEmail?.trim().toLowerCase();
  if (!owner) return { status: "no-recipient", emailed: false };

  try {
    const emailed = await wantsEmail(owner);
    const failed = outcome === "failed";
    const title = failed ? "Generation failed" : "Generation finished";
    const body = failed
      ? `${summarize(run)}\n\n${run.error ?? "The run ended without a result."}`
      : summarize(run);

    await notifyWithDelivery(
      {
        severity: failed ? "warning" : "info",
        title,
        body,
        channels: emailed ? ["inbox", "email"] : ["inbox"],
        metadata: {
          kind: "generation_run",
          runId: run.id,
          libraryId: run.libraryId,
          outcome,
          // The email channel is a no-op without explicit recipients.
          ...(emailed ? { emailRecipients: [owner], emailSubject: title } : {}),
        },
      },
      { owner },
    );
    return { status: "notified", emailed };
  } catch (err) {
    // A generation that produced an asset must not be reported as failed just
    // because the mail server was down.
    console.error(
      `[assets] Could not notify ${owner} that run ${run.id} ${outcome}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { status: "notification-error", emailed: false };
  }
}
