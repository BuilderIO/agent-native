import type { AgentChatPluginOptions } from "@agent-native/core/server";

export const SLIDES_REALTIME_VOICE = {
  instructions: `Voice edits: make the smallest change that matches the words. Treat a relative request such as "bigger" or "more spacing" as one step on the scale: the next type size or spacing step in the deck's design system. After an edit, say what changed with its new value, such as "The title is now 48px," then ask "More or less?" When the target or the size is unclear, ask that short question instead of guessing. When the user corrects themselves mid-sentence, act only on their final request.`,
  priorityToolNames: ["get-deck", "update-slide"],
  defaultIntelligence: "balanced",
} satisfies NonNullable<AgentChatPluginOptions["realtimeVoice"]>;
