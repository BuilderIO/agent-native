import type { DesignTool } from "./index";
import type { PasteWarnings } from "./ir";

const TOOL_LABELS: Record<DesignTool, string> = {
  figma: "Figma",
  paper: "Paper",
  wonder: "Wonder",
};

export function designToolLabel(tool: DesignTool): string {
  return TOOL_LABELS[tool];
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The localized lines for a paste's warnings, most actionable first. The
 * technical detail behind them goes to the console, not the toast.
 */
export function describePasteWarnings(
  warnings: PasteWarnings,
  tool: DesignTool,
  t: Translate,
): string[] {
  const label = designToolLabel(tool);
  let inexactCount = 0;
  let placeholders = 0;
  let linked = 0;
  let unsaved = 0;
  const layerTypes = new Set<string>();
  const details: string[] = [];
  for (const warning of warnings) {
    switch (warning.kind) {
      case "inexact":
        inexactCount += 1;
        details.push(warning.detail);
        break;
      case "layer-type":
        layerTypes.add(warning.type);
        details.push(`layer type ${warning.type}`);
        break;
      case "image-placeholders":
        placeholders += warning.count;
        break;
      case "images-unsaved":
        unsaved += warning.count;
        break;
      case "images-linked":
        linked += warning.count;
        if (warning.reason) details.push(warning.reason);
        break;
    }
  }
  if (details.length > 0) console.warn(`[design-paste] ${label}:`, details);
  const lines: string[] = [];
  if (unsaved > 0) {
    lines.push(
      t("designEditor.import.pasteImagesUnsaved", {
        count: unsaved,
        tool: label,
      }),
    );
  }
  if (linked > 0) {
    lines.push(
      t("designEditor.import.pasteImagesLinked", {
        count: linked,
        tool: label,
      }),
    );
  }
  if (placeholders > 0) {
    lines.push(
      t("designEditor.import.pasteImagePlaceholders", {
        count: placeholders,
        tool: label,
      }),
    );
  }
  if (layerTypes.size > 0) {
    lines.push(
      t("designEditor.import.pasteLayerTypes", {
        count: layerTypes.size,
        tool: label,
      }),
    );
  }
  if (inexactCount > 0) {
    lines.push(t("designEditor.import.pasteInexact", { count: inexactCount }));
  }
  return lines;
}
