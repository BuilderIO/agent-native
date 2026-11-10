import { fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  REVIEW_AGENT_ALLOWED_ACTIONS,
  isReviewAgentActive,
  type ReviewAgentIntent,
  type ReviewAgentStatus,
} from "../../shared/review-agent.js";
import { reviewAgentMachine } from "./review-agent-machine.js";
import {
  REVIEW_AGENT_SCOPE,
  REVIEW_AGENT_THREAD_PREFIX,
  findReviewAgentRequest,
  findReviewAgentRequestsByThread,
  reconcileReviewAgentRun,
  reviewAgentIntentSchema,
  type ReviewAgentRunStatus,
} from "./review-agent.js";

/** The only scope shape a browser may declare; everything else is filled in here. */
const declaredScopeSchema = z
  .object({
    kind: z.enum([REVIEW_AGENT_SCOPE.agent, REVIEW_AGENT_SCOPE.classifier]),
    requestId: z.string().uuid(),
  })
  .strict();

export interface ReviewAgentSurfaceDetails {
  ownerEmail: string | null;
  threadId?: string;
  requestedTurnId?: string;
  queuedMessageId?: string;
  actionScope?: Readonly<Record<string, unknown>>;
}

export type ReviewAgentActionSurface =
  | { mode: "default" }
  | {
      allowedActionNames: string[];
      actionScope: {
        kind: (typeof REVIEW_AGENT_SCOPE)[keyof typeof REVIEW_AGENT_SCOPE];
        requestId: string;
        phase: "classification" | "execution";
        intent: ReviewAgentIntent | null;
      };
    };

/** The tool names a run may call for a request in this state. Nothing else exists for the run. */
export function allowedActionNamesFor(
  status: ReviewAgentStatus,
  phase: "classification" | "execution",
  intent: ReviewAgentIntent | null,
): string[] {
  if (!isReviewAgentActive(status)) {
    return [...REVIEW_AGENT_ALLOWED_ACTIONS.terminal];
  }
  if (phase === "classification") {
    return status === "classifying"
      ? [...REVIEW_AGENT_ALLOWED_ACTIONS.classification]
      : [...REVIEW_AGENT_ALLOWED_ACTIONS.terminal];
  }
  if (intent === null) {
    return fail("This request has not been classified yet.", {
      statusCode: 409,
      errorCode: "not_classified",
    });
  }
  return [...REVIEW_AGENT_ALLOWED_ACTIONS[intent]];
}

function bindingFailure(message: string, errorCode = "binding_missing"): never {
  return fail(message, { statusCode: 409, errorCode });
}

/**
 * Decide which tools a chat request may use, from the stored request and never
 * from the prompt. An ordinary chat request returns the default surface
 * without touching the database. A request that is, or declares itself to be,
 * a review agent run gets exactly the tools its phase and intent allow, and a
 * thread whose request is gone fails closed: the thread id prefix is reserved,
 * so no such thread may fall back to the full tool set.
 */
export async function resolveReviewAgentActionSurface(
  details: ReviewAgentSurfaceDetails,
): Promise<ReviewAgentActionSurface> {
  const declaredRaw = details.actionScope;
  const declaresReviewScope =
    declaredRaw !== undefined &&
    (declaredRaw.kind === REVIEW_AGENT_SCOPE.agent ||
      declaredRaw.kind === REVIEW_AGENT_SCOPE.classifier);
  const declared = declaresReviewScope
    ? declaredScopeSchema.safeParse(declaredRaw)
    : undefined;
  if (declared && !declared.success) {
    return bindingFailure("This agent request's scope is invalid.");
  }
  const threadId = details.threadId;
  if (!declared && !threadId?.startsWith(REVIEW_AGENT_THREAD_PREFIX)) {
    return { mode: "default" };
  }

  let row = declared
    ? await findReviewAgentRequest(declared.data.requestId)
    : undefined;
  if (!declared && threadId) {
    const bound = await findReviewAgentRequestsByThread(threadId);
    if (bound.length > 1) {
      return bindingFailure(
        "This agent thread is bound to more than one request.",
        "thread_conflict",
      );
    }
    row = bound[0];
  }
  if (
    !row ||
    !details.ownerEmail ||
    row.requesterEmail !== details.ownerEmail
  ) {
    return bindingFailure("This agent thread has no request.");
  }

  const phase =
    threadId && threadId === row.classificationThreadId
      ? "classification"
      : threadId && threadId === row.agentThreadId
        ? "execution"
        : null;
  if (!phase) {
    return bindingFailure("This agent thread is not bound to the request.");
  }
  const kind =
    phase === "classification"
      ? REVIEW_AGENT_SCOPE.classifier
      : REVIEW_AGENT_SCOPE.agent;
  if (declared && declared.data.kind !== kind) {
    return bindingFailure(
      "This agent request's scope does not match its thread.",
    );
  }

  // The first message of a session must carry the turn the request minted, so a
  // scope cannot be lent to another turn. Later messages, such as a follow-up
  // typed into the opened chat, keep the same restricted tool set.
  const operationId =
    phase === "classification" ? `${row.id}:classification` : row.id;
  const expectedTurnId =
    phase === "classification" ? row.classificationTurnId : row.agentTurnId;
  if (!expectedTurnId) {
    return bindingFailure("This agent request is missing its turn binding.");
  }
  if (
    details.queuedMessageId === operationId &&
    details.requestedTurnId !== expectedTurnId
  ) {
    return bindingFailure("This agent turn is not bound to the request.");
  }

  const intent =
    row.intent === null ? null : reviewAgentIntentSchema.parse(row.intent);
  return {
    allowedActionNames: allowedActionNamesFor(
      reviewAgentMachine.parseState(row.status),
      phase,
      intent,
    ),
    actionScope: { kind, requestId: row.id, phase, intent },
  };
}

const runStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "truncated",
  "errored",
  "aborted",
  "unavailable",
]);

/**
 * Close a request whose run has ended without finishing it. Core calls this
 * when a run chunk ends, even if the tab that started it is gone. The browser
 * reconciles too, and either may run first: the transitions are
 * compare-and-set, so the second one changes nothing.
 */
export async function finalizeReviewAgentRun(
  scope: { type: string; id: string } | null | undefined,
  run: { threadId: string; turnId: string; runId: string; status: string },
  outcome: { turnContinues: boolean },
): Promise<void> {
  if (!scope || outcome.turnContinues) return;
  const phase =
    scope.type === REVIEW_AGENT_SCOPE.agent
      ? "execution"
      : scope.type === REVIEW_AGENT_SCOPE.classifier
        ? "classification"
        : null;
  if (!phase) return;
  const status: ReviewAgentRunStatus = runStatusSchema.parse(run.status);
  // Deleting the design deletes its requests, so a run can outlive its row.
  // That is nothing left to finalize; a failed lookup still throws.
  if (!(await findReviewAgentRequest(scope.id))) return;
  await reconcileReviewAgentRun({
    requestId: scope.id,
    phase,
    status,
    runId: run.runId,
    run: { threadId: run.threadId, turnId: run.turnId },
  });
}
