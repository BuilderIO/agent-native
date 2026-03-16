// @agent-native/pinpoint — Split output for sendToAgentChat()
// MIT License
//
// Splits annotation output into { message, context } for the agent chat bridge.
// The message is shown in chat UI. The context is hidden, appended for the agent.

import type { Pin, OutputFormat } from "../types/index.js";
import { formatPins } from "./formatter.js";

export interface AgentOutput {
  message: string;
  context: string;
}

/**
 * Format pins for agent chat, splitting into visible message + hidden context.
 */
export function formatPinsForAgent(
  pins: Pin[],
  format: OutputFormat = "standard",
): AgentOutput {
  if (pins.length === 0) {
    return { message: "No annotations to send.", context: "" };
  }

  const pageUrl = pins[0].pageUrl;
  const pinCount = pins.length;

  // Message: short summary shown in chat
  const summaries = pins
    .slice(0, 5)
    .map((pin, i) => `${i + 1}. ${pin.comment}`)
    .join("\n");
  const overflow = pinCount > 5 ? `\n...and ${pinCount - 5} more` : "";

  const message = `I have ${pinCount} annotation${pinCount === 1 ? "" : "s"} on ${pageUrl}:\n${summaries}${overflow}`;

  // Context: full structured output for the agent
  const context = formatPins(pins, format);

  return { message, context };
}
