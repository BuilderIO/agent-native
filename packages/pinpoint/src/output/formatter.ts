// @agent-native/pinpoint — Output formatting (compact/standard/detailed)
// MIT License

import type { Pin, OutputFormat } from "../types/index.js";

/**
 * Format pins into a human/agent-readable markdown string.
 */
export function formatPins(
  pins: Pin[],
  format: OutputFormat = "standard",
): string {
  if (pins.length === 0) return "No annotations.";

  const pageUrl = pins[0].pageUrl;

  switch (format) {
    case "compact":
      return formatCompact(pins, pageUrl);
    case "standard":
      return formatStandard(pins, pageUrl);
    case "detailed":
      return formatDetailed(pins, pageUrl);
    default:
      return formatStandard(pins, pageUrl);
  }
}

function formatCompact(pins: Pin[], pageUrl: string): string {
  const lines = [`## Page Feedback: ${pageUrl} (${pins.length} annotations)`];
  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i];
    lines.push(`${i + 1}. \`${pin.element.selector}\` — "${pin.comment}"`);
  }
  return lines.join("\n");
}

function formatStandard(pins: Pin[], pageUrl: string): string {
  const lines = [
    `## Page Feedback: ${pageUrl}`,
    `${pins.length} annotation${pins.length === 1 ? "" : "s"} | ${new Date().toISOString()}`,
    "",
  ];

  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i];
    lines.push(`### ${i + 1}: \`${pin.element.selector}\``);
    lines.push(`**Comment:** ${pin.comment}`);
    lines.push(
      `**Element:** \`<${pin.element.tagName}>\`${pin.element.classNames.length > 0 ? ` with classes \`.${pin.element.classNames.join(" .")}\`` : ""}`,
    );

    if (pin.framework) {
      lines.push(
        `**Component:** ${pin.framework.componentPath} (${pin.framework.framework})`,
      );
      if (pin.framework.sourceFile) {
        lines.push(`**Source:** \`${pin.framework.sourceFile}\``);
      }
    }

    const rect = pin.element.boundingRect;
    lines.push(
      `**Position:** (${rect.x}, ${rect.y}) ${rect.width}x${rect.height}`,
    );
    lines.push(`**Status:** ${pin.status.state}`);

    if (pin.author) {
      lines.push(`**Author:** ${pin.author}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatDetailed(pins: Pin[], pageUrl: string): string {
  const lines = [formatStandard(pins, pageUrl)];

  // Append detailed info for each pin
  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i];
    const detailLines: string[] = [];

    if (pin.element.domPath) {
      detailLines.push(`**DOM Path:** ${pin.element.domPath}`);
    }

    if (
      pin.element.computedStyles &&
      Object.keys(pin.element.computedStyles).length > 0
    ) {
      const styles = Object.entries(pin.element.computedStyles)
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");
      detailLines.push(`**Computed Styles:** ${styles}`);
    }

    if (
      pin.element.ariaAttributes &&
      Object.keys(pin.element.ariaAttributes).length > 0
    ) {
      const aria = Object.entries(pin.element.ariaAttributes)
        .map(([key, value]) => `${key}="${value}"`)
        .join(", ");
      detailLines.push(`**Accessibility:** ${aria}`);
    }

    if (pin.element.textContent) {
      detailLines.push(`**Text Content:** "${pin.element.textContent}"`);
    }

    if (
      pin.element.dataAttributes &&
      Object.keys(pin.element.dataAttributes).length > 0
    ) {
      const data = Object.entries(pin.element.dataAttributes)
        .map(([key, value]) => `${key}="${value}"`)
        .join(", ");
      detailLines.push(`**Data Attributes:** ${data}`);
    }

    if (detailLines.length > 0) {
      lines.push(`#### Details for #${i + 1}:`);
      lines.push(detailLines.join("\n"));
      lines.push("");
    }
  }

  return lines.join("\n");
}
