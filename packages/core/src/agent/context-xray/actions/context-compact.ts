import { z } from "zod";

import { defineAction, fail } from "../../../action.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../../../server/request-context.js";
import {
  compactThreadNow,
  getThreadCompactionStatus,
} from "../../observational-memory/compactor.js";
import { callerOwnsThread } from "../../run-ownership.js";

export interface ContextCompactResult {
  threadId: string;
  /** `nothing-to-compact` means every message was already compacted. */
  status: "compacted" | "nothing-to-compact";
  /** Conversation tokens folded into the new observation. */
  compactedTokens: number;
  /** Size of the observation that replaces them in future model calls. */
  observationTokens: number;
  /** The Reflector also condensed the observation log. */
  reflected: boolean;
  message: string;
}

const contextCompactResultSchema = z.object({
  threadId: z.string(),
  status: z.enum(["compacted", "nothing-to-compact"]),
  compactedTokens: z.number(),
  observationTokens: z.number(),
  reflected: z.boolean(),
  message: z.string(),
});

export default defineAction({
  description:
    "Compact a chat thread's context now: summarize every message not yet compacted into an observational-memory entry that future model calls read in place of those messages, instead of waiting for the automatic post-turn threshold. The transcript is not changed or deleted. Takes effect on the next model call. Only the thread owner can compact it.",
  schema: z.object({
    threadId: z.string().min(1).describe("Chat thread id to compact."),
  }),
  outputSchema: contextCompactResultSchema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (args): Promise<ContextCompactResult> => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("Sign in to compact a thread.", {
        errorCode: "auth_required",
        statusCode: 401,
      });
    }
    if (!(await callerOwnsThread(ownerEmail, args.threadId))) {
      fail("Thread not found.", { errorCode: "not_found", statusCode: 404 });
    }
    const owner = {
      ownerEmail,
      orgId: getRequestOrgId() ?? null,
      threadId: args.threadId,
    };
    // A cursor past the saved messages makes the Observer see nothing to do,
    // which would read as "already compacted" when it is not.
    const before = await getThreadCompactionStatus(owner);
    if (before.tokensUntilAutoCompact === undefined) {
      fail(
        "Can't compact this thread: its compaction record is ahead of the saved messages.",
        { errorCode: "compaction_cursor_ahead", statusCode: 409 },
      );
    }
    let result: Awaited<ReturnType<typeof compactThreadNow>>;
    try {
      result = await compactThreadNow(owner);
    } catch (error) {
      fail(
        `Could not compact this thread: ${error instanceof Error ? error.message : String(error)}`,
        { errorCode: "compaction_failed", statusCode: 500 },
      );
    }
    const { observer, reflector } = result;
    if (!observer.observed) {
      if (observer.unobservedTokens === 0) {
        return {
          threadId: args.threadId,
          status: "nothing-to-compact",
          compactedTokens: 0,
          observationTokens: 0,
          reflected: reflector.reflected,
          message: "Everything in this thread is already compacted.",
        };
      }
      fail("Compaction produced no summary, so nothing was replaced.", {
        errorCode: "compaction_empty",
        statusCode: 500,
        details: { unobservedTokens: observer.unobservedTokens },
      });
    }
    if (!observer.entry) {
      fail("Compaction finished without saving an observation.", {
        errorCode: "compaction_failed",
        statusCode: 500,
      });
    }
    const observationTokens = observer.entry.tokenEstimate;
    return {
      threadId: args.threadId,
      status: "compacted",
      compactedTokens: observer.unobservedTokens,
      observationTokens,
      reflected: reflector.reflected,
      message: `Compacted ${observer.unobservedTokens} tokens into a ${observationTokens}-token observation. It applies from the next message.`,
    };
  },
});
