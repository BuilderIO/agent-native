import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import {
  transactionalEmailStore,
  type RecapCopy,
} from "../server/lib/transactional-email-store.js";

export const MAX_RECAP_MODULE_LENGTH = 240;

const RECAP_MODULE_LABELS: Record<keyof RecapCopy, string> = {
  heroLine: "Hero line",
  agentBreakdown: "Agent breakdown",
  completionNote: "Completion note",
};

export function validateRecapModule(
  field: keyof RecapCopy,
  value: string,
): string {
  const text = value.replace(/\s+/g, " ").trim();
  const label = RECAP_MODULE_LABELS[field];
  if (!text) throw new Error(`${label} must not be empty.`);
  if (text.length > MAX_RECAP_MODULE_LENGTH) {
    throw new Error(
      `${label} must be at most ${MAX_RECAP_MODULE_LENGTH} characters.`,
    );
  }
  if (/[<>]/.test(text)) {
    throw new Error(`${label} must be plain text without HTML.`);
  }
  return text;
}

export function validateRecapCopy(copy: RecapCopy): RecapCopy {
  return {
    heroLine: validateRecapModule("heroLine", copy.heroLine),
    agentBreakdown: validateRecapModule("agentBreakdown", copy.agentBreakdown),
    completionNote: validateRecapModule("completionNote", copy.completionNote),
  };
}

export default defineAction({
  description:
    "Complete only the claimed monthly Clips recap email copy workflow.",
  schema: z.object({
    jobId: z.string().trim().min(1),
    heroLine: z.string().max(2_000),
    agentBreakdown: z.string().max(2_000),
    completionNote: z.string().max(2_000),
  }),
  run: async ({ jobId, ...copy }) => {
    const claimantEmail = getCurrentOwnerEmail().trim().toLowerCase();
    const completed = await transactionalEmailStore.completeClaimedRecapCopy(
      jobId,
      claimantEmail,
      validateRecapCopy(copy),
    );
    if (!completed) {
      throw new Error("This Clips recap AI claim is unavailable.");
    }
    return {
      jobId: completed.logicalKey,
      logicalKey: completed.logicalKey,
      state: completed.state,
      generatedRecapCopy: completed.generatedRecapCopy,
    };
  },
});
