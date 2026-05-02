// @agent-native/pinpoint — Split output for sendToAgentChat()
// MIT License
//
// Splits annotation output into { message, context } for the agent chat bridge.
// The message is shown in chat UI. The context is hidden, appended for the agent.

import type {
  AgentOutput,
  Pin,
  OutputFormat,
  QueuedAnnotation,
} from "../types/index.js";
import { formatPins } from "./formatter.js";

export type { AgentOutput } from "../types/index.js";

/**
 * Format a single pin into rich context for the agent.
 *
 * ```
 * [Annotation on <button class="primary"> in <Header> component]
 * Comment: "This button should be blue instead of gray"
 * Element: button.primary at (120, 45)
 * Source: src/components/Header.tsx:42
 * ```
 */
export function formatRichPinContext(pin: Pin): string {
  const lines: string[] = [];

  // Build element descriptor
  const tagName = pin.element.tagName.toLowerCase();
  const classes =
    pin.element.classNames.length > 0
      ? ` class="${pin.element.classNames.join(" ")}"`
      : "";
  const component = pin.framework?.componentPath
    ? ` in ${pin.framework.componentPath} component`
    : "";

  lines.push(`[Annotation on <${tagName}${classes}>${component}]`);
  lines.push(`Comment: "${pin.comment}"`);

  const rect = pin.element.boundingRect;
  const classStr =
    pin.element.classNames.length > 0
      ? `.${pin.element.classNames.join(".")}`
      : "";
  lines.push(
    `Element: ${tagName}${classStr} at (${Math.round(rect.x)}, ${Math.round(rect.y)})`,
  );

  if (pin.framework?.sourceFile) {
    lines.push(`Source: ${pin.framework.sourceFile}`);
  }

  if (pin.element.textContent) {
    const truncated = pin.element.textContent.slice(0, 80);
    lines.push(
      `Text: "${truncated}${pin.element.textContent.length > 80 ? "..." : ""}"`,
    );
  }

  return lines.join("\n");
}

/**
 * Format pins for agent chat.
 * The full formatted output goes into message (visible in chat UI) so the user
 * can see exactly what context the agent is working with.
 */
export function formatPinsForAgent(
  pins: Pin[],
  format: OutputFormat = "standard",
): AgentOutput {
  if (pins.length === 0) {
    return { message: "No annotations to send.", context: "" };
  }

  // Use rich context format for each pin
  const richAnnotations = pins
    .map((pin) => formatRichPinContext(pin))
    .join("\n\n");

  const instruction = `The user has annotated ${pins.length} element${pins.length === 1 ? "" : "s"} on the page with visual feedback. Review each annotation and make the requested changes.\n\n`;

  // Also include the structured format as context for the agent
  const details = formatPins(pins, format);
  const message = instruction + richAnnotations;

  return { message, context: details };
}

/**
 * Format queued annotations for batch sending.
 */
export function formatQueueForAgent(
  queue: QueuedAnnotation[],
  format: OutputFormat = "standard",
): AgentOutput {
  if (queue.length === 0) {
    return { message: "No queued annotations to send.", context: "" };
  }

  const parts: string[] = [];
  const pins: Pin[] = [];

  parts.push(
    `The user has queued ${queue.length} annotation${queue.length === 1 ? "" : "s"} for batch review. Process each one:\n`,
  );

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    parts.push(`--- Item ${i + 1} ---`);

    if (item.pin) {
      parts.push(formatRichPinContext(item.pin));
      pins.push(item.pin);
    }

    if (item.drawings && item.drawings.length > 0) {
      parts.push(`[Drawing: ${item.drawings.length} stroke(s) on the page]`);
      for (const stroke of item.drawings) {
        const startPt = stroke.points[0];
        const endPt = stroke.points[stroke.points.length - 1];
        parts.push(
          `  ${stroke.type} from (${Math.round(startPt.x)}, ${Math.round(startPt.y)}) to (${Math.round(endPt.x)}, ${Math.round(endPt.y)}) [${stroke.color}]`,
        );
      }
    }

    if (item.textNotes && item.textNotes.length > 0) {
      for (const note of item.textNotes) {
        parts.push(
          `[Text note at (${Math.round(note.x)}, ${Math.round(note.y)}): "${note.text}"]`,
        );
      }
    }

    parts.push("");
  }

  const message = parts.join("\n");
  const context = pins.length > 0 ? formatPins(pins, format) : "";

  return { message, context };
}
