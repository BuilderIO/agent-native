import type { AgentChatPluginOptions } from "@agent-native/core/server";

export const DESIGN_REALTIME_VOICE = {
  instructions: `Voice edits: make the smallest change that matches the words. Treat a relative request such as "bigger" or "more spacing" as one step on the scale: the next type size, spacing, or radius token in the design system. After an edit, say what changed with its new value, such as "The heading is now 32px," then ask "More or less?" When the target or the size is unclear, ask that short question instead of guessing. When the user corrects themselves mid-sentence, act only on their final request.`,
  priorityToolNames: ["get-design-snapshot", "edit-design"],
  defaultIntelligence: "balanced",
} satisfies NonNullable<AgentChatPluginOptions["realtimeVoice"]>;
