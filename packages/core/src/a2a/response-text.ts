import type { AgentChatEvent } from "../agent/types.js";

export function collectFinalResponseTextFromAgentEvents(
  events: readonly AgentChatEvent[],
): string {
  let lastToolIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const type = events[i].type;
    if (type === "tool_start" || type === "tool_done") {
      lastToolIdx = i;
      break;
    }
  }

  const startIdx = lastToolIdx >= 0 ? lastToolIdx + 1 : 0;
  let responseText = collectTextEvents(events, startIdx);

  // Some agents let the final tool output speak for itself. Fall back to all
  // text so callers do not get an empty reply just because no post-tool text
  // was emitted.
  if (!responseText.trim() && lastToolIdx >= 0) {
    responseText = collectTextEvents(events, 0);
  }

  return responseText;
}

function collectTextEvents(
  events: readonly AgentChatEvent[],
  startIdx: number,
): string {
  let text = "";
  for (let i = startIdx; i < events.length; i++) {
    const event = events[i];
    if (event.type === "text") text += event.text;
  }
  return text;
}
