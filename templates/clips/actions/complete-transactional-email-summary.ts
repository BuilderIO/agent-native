import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import { transactionalEmailStore } from "../server/lib/transactional-email-store.js";

export const MAX_TRANSACTIONAL_EMAIL_SUMMARY_LENGTH = 320;

export function normalizeTransactionalEmailSummary(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function validateTransactionalEmailSummary(value: string): string {
  const summary = normalizeTransactionalEmailSummary(value);
  if (!summary) throw new Error("Summary must be one nonempty sentence.");
  if (summary.length > MAX_TRANSACTIONAL_EMAIL_SUMMARY_LENGTH) {
    throw new Error(
      `Summary must be at most ${MAX_TRANSACTIONAL_EMAIL_SUMMARY_LENGTH} characters.`,
    );
  }
  if (/[<>]/.test(summary)) {
    throw new Error("Summary must be plain text without HTML.");
  }
  const sentenceEndings = summary.match(/[.!?](?=\s|$)/g) ?? [];
  if (sentenceEndings.length !== 1 || !/[.!?]$/.test(summary)) {
    throw new Error("Summary must be exactly one sentence.");
  }
  return summary;
}

export default defineAction({
  description:
    "Complete only the claimed two-Clip transactional email summary workflow.",
  schema: z.object({
    jobId: z.string().trim().min(1),
    summary: z.string().max(2_000),
  }),
  run: async ({ jobId, summary }) => {
    const claimantEmail = getCurrentOwnerEmail().trim().toLowerCase();
    const normalizedSummary = validateTransactionalEmailSummary(summary);
    const completed = await transactionalEmailStore.completeClaimedAi(
      jobId,
      claimantEmail,
      normalizedSummary,
    );
    if (!completed) {
      throw new Error("This transactional email AI claim is unavailable.");
    }
    return {
      jobId: completed.logicalKey,
      logicalKey: completed.logicalKey,
      state: completed.state,
      generatedSummary: completed.generatedSummary,
    };
  },
});
