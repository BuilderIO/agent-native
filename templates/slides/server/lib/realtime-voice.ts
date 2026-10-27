import type { AgentChatPluginOptions } from "@agent-native/core/server";

export const SLIDES_REALTIME_VOICE = {
  instructions: `Voice edits: make the smallest change that matches the words. Treat a relative request such as "bigger" or "more spacing" as one step on the scale: the next type size or spacing step in the deck's design system. After an edit, say what changed with its new value, such as "The title is now 48px," then ask "More or less?" When the target or the size is unclear, ask that short question instead of guessing. When the user corrects themselves mid-sentence, act only on their final request. For a change across the deck, call get-deck once with compact=false, then make one patch-deck call with the same edit for every slide. When update-slide or patch-deck returns ok, the edit is done: say so, and do not call get-deck again to check it; patch-deck's updatedSlideIds already lists the slides that changed. Call get-layout-overflows only after a change to text, size, or layout; a color change cannot overflow.`,
  priorityToolNames: ["get-deck", "update-slide", "get-layout-overflows"],
  defaultIntelligence: "balanced",
} satisfies NonNullable<AgentChatPluginOptions["realtimeVoice"]>;
