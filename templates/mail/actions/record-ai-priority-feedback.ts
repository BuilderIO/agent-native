import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { mutateUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

const feedbackSchema = z.object({
  emailId: z.string().min(1).max(256),
  accountEmail: z.string().email().optional(),
  decision: z.enum(["important", "not-important"]),
  sender: z.string().max(512).optional(),
  subject: z.string().max(2000).optional(),
});
const storedEntrySchema = feedbackSchema.extend({
  createdAt: z.number().int(),
});
const storedSchema = z.union([
  z.array(storedEntrySchema).max(500),
  z.object({
    entries: z.array(storedEntrySchema).max(500),
    totalVotes: z.number().int().nonnegative().optional(),
  }),
]);

function parseStoredFeedback(stored: unknown) {
  const parsed = storedSchema.safeParse(stored);
  if (!parsed.success)
    throw new Error("Stored importance feedback is unreadable.");
  const entries = Array.isArray(parsed.data)
    ? parsed.data
    : parsed.data.entries;
  return {
    entries,
    totalVotes: Array.isArray(parsed.data)
      ? entries.length
      : (parsed.data.totalVotes ?? entries.length),
  };
}

export default defineAction({
  description: "Record a user's importance feedback for an email.",
  schema: feedbackSchema,
  agentTool: true,
  run: async (input) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) fail("Unauthenticated", { errorCode: "unauthenticated" });
    const vote = { ...input, createdAt: Date.now() };
    const updated = await mutateUserSetting(
      ownerEmail,
      "ai-priority-feedback",
      (current) => {
        const { entries, totalVotes } =
          current == null
            ? { entries: [], totalVotes: 0 }
            : parseStoredFeedback(current);
        return {
          entries: [...entries, vote].slice(-500),
          totalVotes: totalVotes + 1,
        };
      },
    );
    const { entries, totalVotes } = parseStoredFeedback(updated);
    return {
      saved: true,
      decision: input.decision,
      totalVotes,
      recentVotes: entries.slice(-5),
    };
  },
});
