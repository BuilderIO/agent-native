import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
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

export default defineAction({
  description: "Record a user's importance feedback for an email.",
  schema: feedbackSchema,
  agentTool: false,
  run: async (input) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) fail("Unauthenticated", { errorCode: "unauthenticated" });
    const stored = await getUserSetting(ownerEmail, "ai-priority-feedback");
    const parsed =
      stored === undefined || stored === null
        ? {
            success: true as const,
            data: [] as z.infer<typeof storedEntrySchema>[],
          }
        : storedSchema.safeParse(stored);
    if (!parsed.success)
      throw new Error("Stored importance feedback is unreadable.");
    const entries = Array.isArray(parsed.data)
      ? parsed.data
      : parsed.data.entries;
    const totalVotes = Array.isArray(parsed.data)
      ? parsed.data.length
      : (parsed.data.totalVotes ?? parsed.data.entries.length);
    const next = [...entries, { ...input, createdAt: Date.now() }];
    await putUserSetting(ownerEmail, "ai-priority-feedback", {
      entries: next.slice(-500),
      totalVotes: totalVotes + 1,
    });
    return {
      saved: true,
      decision: input.decision,
      totalVotes: totalVotes + 1,
      recentVotes: next.slice(-5),
    };
  },
});
