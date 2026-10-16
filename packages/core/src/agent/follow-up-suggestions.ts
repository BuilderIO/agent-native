import type { AgentSuggestion } from "@agent-native/agentkit/protocol";
import { z } from "zod";

import { clipHead, clipTail } from "./clip-text.js";
import type { EngineMessage, EngineTool } from "./engine/types.js";

export const FOLLOW_UP_SUGGESTIONS_TOOL_NAME = "suggest-follow-ups";
export const FOLLOW_UP_SUGGESTIONS_MAX_OUTPUT_TOKENS = 1024;
export const FOLLOW_UP_SUGGESTIONS_INSTRUCTION =
  "Before finishing this turn, evaluate useful next actions grounded in the user's request, conversation, app workflow/current context, and observed results. " +
  "Record your decision with suggest-follow-ups: zero to three meaningful next intents, or an empty list when none is warranted. Do not fill a quota or repeat completed work.";

export const FOLLOW_UP_SUGGESTIONS_COMPLETION_SYSTEM_PROMPT =
  "You write follow-up suggestions for a conversation between a user and an AI agent inside an app. You only record them by calling suggest-follow-ups.";

export const FOLLOW_UP_SUGGESTIONS_COMPLETION_INSTRUCTION =
  "The final reply above has already been delivered. Complete only its missing follow-up metadata by calling suggest-follow-ups once, using the request, reply, and tools used above. " +
  "An empty list is valid when no useful next action exists. Do not repeat the reply, perform more work, or call other tools.";

// The ask sits at the end of a long pasted document and a long reply's
// conclusions sit at the end, so a clip keeps the tail.
const COMPLETION_REQUEST_HEAD_CHARS = 500;
const COMPLETION_REQUEST_TAIL_CHARS = 1_500;
const COMPLETION_REPLY_TAIL_CHARS = 4_000;
const MAX_COMPLETION_TOOL_NAMES = 30;

function clipMiddle(text: string, head: number, tail: number): string {
  return text.length > head + tail
    ? `${clipHead(text, head)}\n…\n${clipTail(text, tail)}`
    : text;
}

// Providers reject an empty first user message or an empty assistant text, so a
// turn with no request text or no reply text still sends a stated absence.
const NO_REQUEST_TEXT = "(No request text was recorded for this turn.)";
const NO_REPLY_TEXT = "(The reply had no text.)";

/**
 * The completion call sends a different tools array than the turn did, so it
 * can never read the turn's prompt cache. It carries a bounded digest of the
 * turn instead of re-prefilling the whole conversation at full price. The
 * digest keeps the shape of a finished turn (request, reply, then the
 * instruction as the last user message) so role alternation is valid for every
 * provider and the instruction stays the message a prefix match finds.
 */
export function buildFollowUpCompletionMessages(input: {
  requestText?: string;
  replyText: string;
  toolNames: readonly string[];
}): EngineMessage[] {
  const requestText = input.requestText?.trim();
  const replyText = input.replyText.trim();
  const toolNames = [...new Set(input.toolNames)]
    .filter((name) => name !== FOLLOW_UP_SUGGESTIONS_TOOL_NAME)
    .slice(0, MAX_COMPLETION_TOOL_NAMES);
  const request = [
    requestText
      ? `<user-request>\n${clipMiddle(requestText, COMPLETION_REQUEST_HEAD_CHARS, COMPLETION_REQUEST_TAIL_CHARS)}\n</user-request>`
      : "",
    toolNames.length > 0
      ? `<tools-used>${toolNames.join(", ")}</tools-used>`
      : "",
  ].filter(Boolean);
  return [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: request.length > 0 ? request.join("\n\n") : NO_REQUEST_TEXT,
        },
      ],
    },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: replyText
            ? clipMiddle(replyText, 0, COMPLETION_REPLY_TAIL_CHARS)
            : NO_REPLY_TEXT,
        },
      ],
    },
    {
      role: "user",
      content: [
        { type: "text", text: FOLLOW_UP_SUGGESTIONS_COMPLETION_INSTRUCTION },
      ],
    },
  ];
}

export type FollowUpSuggestionsFailure =
  | "budget_exhausted"
  | "iteration_limit"
  | "interrupted"
  | "processor_error"
  | "provider_error"
  | "invalid_or_missing";

const followUpSuggestionsSchema = z
  .strictObject({
    suggestions: z
      .array(
        z.strictObject({
          label: z
            .string()
            .trim()
            .min(1)
            .max(80)
            .regex(/^[^\r\n]+$/)
            .describe("Concise next-action label, in the user's language."),
          prompt: z
            .string()
            .trim()
            .min(1)
            .max(600)
            .describe(
              "Self-contained user request to continue this conversation; never execute it now.",
            ),
        }),
      )
      .max(3)
      .describe(
        "Zero to three distinct, grounded next actions; empty when none is useful.",
      ),
  })
  .superRefine(({ suggestions }, ctx) => {
    for (const field of ["label", "prompt"] as const) {
      const seen = new Set<string>();
      suggestions.forEach((suggestion, index) => {
        const key = suggestion[field].toLowerCase();
        if (seen.has(key)) {
          ctx.addIssue({
            code: "custom",
            path: ["suggestions", index, field],
            message: "Follow-ups must be distinct.",
          });
        }
        seen.add(key);
      });
    }
  });

const { $schema: _schemaDialect, ...followUpInputSchema } = z.toJSONSchema(
  followUpSuggestionsSchema,
);

export const followUpSuggestionsTool: EngineTool = {
  name: FOLLOW_UP_SUGGESTIONS_TOOL_NAME,
  description:
    "Record the follow-up decision before or alongside your final reply, after observing the results of all work for this turn. " +
    "Use the conversation, app workflow, current screen/selection, and completed results to propose concise, useful next user intents. " +
    "Do not repeat completed work, invent capabilities, force generic options, or put secrets in suggestions. " +
    "Use an empty list when no follow-up is useful or the user must answer a question first. " +
    "This is response metadata, not an action: it never executes a suggestion. Still provide your normal final reply. Do not combine this with other tool calls.",
  inputSchema: followUpInputSchema as EngineTool["inputSchema"],
};

export function parseFollowUpSuggestions(input: unknown) {
  return followUpSuggestionsSchema.safeParse(input);
}

export function identifyFollowUpSuggestions(
  suggestions: z.infer<typeof followUpSuggestionsSchema>["suggestions"],
  runId: string,
): AgentSuggestion[] {
  const updatedAt = new Date().toISOString();
  return suggestions.map((suggestion, index) => ({
    ...suggestion,
    id: `${runId}:follow-up:${index + 1}`,
    runId,
    updatedAt,
  }));
}
