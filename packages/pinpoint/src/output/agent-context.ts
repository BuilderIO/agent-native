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
 * Format pins for agent chat.
 * The full formatted output goes into message (visible in chat UI) so the user
 * can see exactly what context the agent is working with. Context is kept empty
 * since all details are already in the message.
 */
export function formatPinsForAgent(
  pins: Pin[],
  format: OutputFormat = "standard",
): AgentOutput {
  if (pins.length === 0) {
    return { message: "No annotations to send.", context: "" };
  }

  // Instruction + full structured output visible in chat
  const details = formatPins(pins, format);
  const instruction = `The user has annotated ${pins.length} element${pins.length === 1 ? "" : "s"} on the page with visual feedback. Review each annotation and make the requested changes.\n\n`;
  const message = instruction + details;

  return { message, context: "" };
}
