import { getThread, type ActionEntry } from "@agent-native/core/server";

const REPROMPT_MUTATION_ALLOWLIST = new Set([
  "propose-node-rewrite",
  "resolve-node-rewrite",
]);

export function isRepromptSelectionMessage(value: string): boolean {
  return /(?:^|\n)\[Reprompt selection\](?:\n|$)/.test(value);
}

export function isSelectionQuestionMessage(value: string): boolean {
  return /(?:^|\n)\[Selection question\](?:\n|$)/.test(value);
}

function latestUserMessageText(threadData: string): string {
  try {
    const parsed = JSON.parse(threadData) as {
      messages?: Array<{
        message?: {
          role?: unknown;
          content?: unknown;
        };
        role?: unknown;
        content?: unknown;
      }>;
    };
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const entry = messages[index]!;
      const message = entry.message ?? entry;
      if (message.role !== "user") continue;
      if (typeof message.content === "string") return message.content;
      if (!Array.isArray(message.content)) return "";
      return message.content
        .filter((part): part is { type: "text"; text: string } =>
          Boolean(
            part &&
            typeof part === "object" &&
            (part as { type?: unknown }).type === "text" &&
            typeof (part as { text?: unknown }).text === "string",
          ),
        )
        .map((part) => part.text)
        .join("\n");
    }
  } catch {}
  return "";
}

function threadSelectionIntent(thread: {
  preview: string;
  threadData: string;
}): "reprompt" | "question" | null {
  const latestMessage = latestUserMessageText(thread.threadData);
  if (
    isRepromptSelectionMessage(thread.preview) ||
    isRepromptSelectionMessage(latestMessage)
  ) {
    return "reprompt";
  }
  if (
    isSelectionQuestionMessage(thread.preview) ||
    isSelectionQuestionMessage(latestMessage)
  ) {
    return "question";
  }
  return null;
}

export function guardRepromptActionRegistry(
  actions: Record<string, ActionEntry>,
): Record<string, ActionEntry> {
  return Object.fromEntries(
    Object.entries(actions).map(([name, entry]) => {
      if (entry.readOnly === true) return [name, entry];
      return [
        name,
        {
          ...entry,
          run: async (args, context) => {
            if (context?.caller === "tool" && context.threadId) {
              const thread = await getThread(context.threadId);
              if (thread) {
                const intent = threadSelectionIntent(thread);
                if (
                  intent === "reprompt" &&
                  !REPROMPT_MUTATION_ALLOWLIST.has(name)
                ) {
                  throw new Error(
                    `The current [Reprompt selection] turn is preview-only. Do not call ${name}; call propose-node-rewrite with the captured repromptId, target, and baseVersionHash instead.`,
                  );
                }
                if (intent === "question") {
                  throw new Error(
                    `The current [Selection question] turn is read-only. Answer the user's question without calling ${name} or changing the design.`,
                  );
                }
              }
            }
            return entry.run(args, context);
          },
        },
      ];
    }),
  );
}
