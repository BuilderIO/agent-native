import {
  defineActionErrors,
  isActionContractError,
} from "@agent-native/core/action";
import type { z } from "zod";

import {
  threadBootstrapCode,
  type StartThreadInput,
} from "../../shared/analytics-thread.js";
import {
  checkedThreadAdmission,
  provisionAnalyticsThread,
  readBootstrap,
  readStartReceipt,
  requireAskProvider,
  threadNotFound,
} from "./analytics-thread-bootstrap.js";
import {
  submitAnalyticsThreadTurn,
  verifyInitialThreadPrompt,
} from "./analytics-thread-turns.js";
import type { NotebookThreadScope } from "./thread-projects.js";

export const threadErrors = defineActionErrors(
  "thread_not_found",
  "thread_forbidden",
  "source_denied",
  "ai_provider_unavailable",
  "admission_unreadable",
  "attachments_pending",
  "intent_mismatch",
  "thread_revision_conflict",
  "run_in_progress",
  "invalid_prompt",
  "recipient_not_member",
  "project_create_denied",
);

export async function startAnalyticsThread(
  scope: NotebookThreadScope,
  input: StartThreadInput,
) {
  const prior = await readBootstrap(scope, input.intentId);
  if (input.trigger.kind === "submit" && prior?.phase !== "submitted") {
    await requireAskProvider(input.trigger.prompt.text);
    if (!prior) await verifyInitialThreadPrompt(scope, input.trigger.prompt);
  }
  const row = await provisionAnalyticsThread(scope, input);
  if (row.initialPrompt && row.initialMessageId) {
    await submitAnalyticsThreadTurn(scope, {
      threadId: row.threadId,
      messageId: row.initialMessageId,
      prompt: row.initialPrompt,
    });
    const updated = await readBootstrap(scope, input.intentId);
    if (!updated) threadNotFound();
    return readStartReceipt(updated);
  }
  return readStartReceipt(row);
}

export async function getAnalyticsThreadBootstrap(
  scope: NotebookThreadScope,
  input: { intentId: string },
) {
  try {
    return await checkedThreadAdmission(async () => {
      const row = await readBootstrap(scope, input.intentId);
      if (!row) threadNotFound();
      const receipt = await readStartReceipt(row);
      if (receipt.phase === "binding") return receipt;
      return { phase: "ready" as const, receipt };
    });
  } catch (error) {
    if (!isActionContractError(error)) throw error;
    const known = threadBootstrapCode.safeParse(error.errorCode);
    if (!known.success) throw error;
    return {
      phase: "failed" as const,
      code: known.data satisfies z.infer<typeof threadBootstrapCode>,
    };
  }
}
