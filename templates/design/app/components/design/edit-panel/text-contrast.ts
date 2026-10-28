import { isLargeText } from "@shared/wcag-contrast";

import { sendToDesignAgentChat } from "@/lib/agent-chat";

import type {
  ContrastAgentRequest,
  DesignColorContrast,
} from "../inspector/color-picker-contrast";
import { requestTextBackground } from "../multi-screen/measure-contrast-background";

/** Where a selected text layer lives, so its background can be read and the agent pointed at it. */
export interface TextContrastContext {
  designId?: string;
  /** The canvas screen the layer is on. */
  screenId: string;
  nodeId?: string;
  /** Selects the layer inside that screen's iframe. */
  selector: string;
}

const FONT_WEIGHT_KEYWORDS: Record<string, number> = {
  normal: 400,
  bold: 700,
};

function readFontWeight(value: string | undefined): number | null {
  const text = value?.trim().toLowerCase();
  if (!text) return null;
  const keyword = FONT_WEIGHT_KEYWORDS[text];
  if (keyword !== undefined) return keyword;
  const weight = Number(text);
  return Number.isFinite(weight) && weight > 0 ? weight : null;
}

/**
 * Whether WCAG counts the text as large, from its computed size and weight.
 * null when either cannot be read, which includes a mixed selection.
 */
export function readLargeText(
  styles: Record<string, string | undefined>,
): boolean | null {
  const size = Number.parseFloat(styles.fontSize ?? "");
  const weight = readFontWeight(styles.fontWeight);
  if (!Number.isFinite(size) || size <= 0 || weight === null) return null;
  return isLargeText(size, weight);
}

type Translate = (key: string, options?: Record<string, string>) => string;

/** What the user asks of the agent, in their language. */
export function contrastAgentMessage(
  t: Translate,
  request: ContrastAgentRequest,
): string {
  if (request.ratio === null || request.background === null) {
    return t("editPanel.colorPicker.contrastPromptUnknown");
  }
  return t("editPanel.colorPicker.contrastPrompt", {
    target: String(request.targetRatio),
    size: t(
      request.large
        ? "editPanel.colorPicker.textSizeLarge"
        : "editPanel.colorPicker.textSizeBody",
    ),
    background: request.background,
    ratio: request.ratio.toFixed(1),
  });
}

/** What the agent needs to find the text and judge it; the selection, not the whole design. */
export function contrastAgentContext(
  context: TextContrastContext,
  request: ContrastAgentRequest,
): string {
  return [
    "Raise the contrast of the selected text layer to WCAG AA.",
    "Change only its color: move OKLCH lightness and keep the hue and chroma.",
    context.designId ? `designId: ${context.designId}` : "",
    `screenId: ${context.screenId}`,
    context.nodeId
      ? `target nodeId (data-agent-native-node-id): ${context.nodeId}`
      : "",
    `selector: ${context.selector}`,
    `text color: ${request.foreground}`,
    request.background
      ? `background behind the text: ${request.background}`
      : "background behind the text: not readable from the editor; inspect it",
    request.ratio !== null ? `contrast now: ${request.ratio.toFixed(2)}:1` : "",
    `AA target: ${request.targetRatio}:1${
      request.large === null
        ? ""
        : request.large
          ? " (large text)"
          : " (body text)"
    }`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The picker's contrast support for one selected text layer. */
export function buildTextContrast({
  context,
  styles,
  t,
}: {
  context: TextContrastContext;
  styles: Record<string, string | undefined>;
  t: Translate;
}): DesignColorContrast {
  return {
    large: readLargeText(styles),
    readBackground: () =>
      requestTextBackground({
        screenId: context.screenId,
        selector: context.selector,
      }),
    onAskAgent: (request) =>
      sendToDesignAgentChat({
        message: contrastAgentMessage(t, request),
        context: contrastAgentContext(context, request),
        submit: true,
        openSidebar: true,
      }),
  };
}
