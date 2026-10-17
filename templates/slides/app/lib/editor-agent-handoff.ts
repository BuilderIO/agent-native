import { sendToAgentChat } from "@agent-native/core/client/agent-chat";

import type { DrawAnnotation } from "../components/visual-editor/DrawOverlay";

export interface EditorAgentPrompt {
  message: string;
  submit: boolean;
}

export function buildSelectionHandoffPrompt(args: {
  slideNumber: number;
  slideId: string;
  selectors: readonly string[];
}): EditorAgentPrompt | null {
  if (args.selectors.length === 0) return null;
  return {
    message: `[Current selection on slide ${args.slideNumber} (${args.slideId}): ${args.selectors.join(", ")}]\n`,
    submit: false,
  };
}

export function buildDrawingHandoffPrompt(args: {
  slideId: string;
  annotations: readonly DrawAnnotation[];
  instruction: string;
  canvasSize: { width: number; height: number };
}): EditorAgentPrompt {
  const summary = args.annotations
    .map((annotation) =>
      annotation.type === "path"
        ? `[stroke ${annotation.color} w=${annotation.lineWidth}] ${annotation.pathData}`
        : `[label "${annotation.text}" at ${annotation.position.x.toFixed(0)},${annotation.position.y.toFixed(0)}]`,
    )
    .join("\n");
  return {
    message: [
      `[Drawing on slide ${args.slideId}]`,
      `Canvas size: ${args.canvasSize.width.toFixed(0)}x${args.canvasSize.height.toFixed(0)}`,
      summary,
      "",
      args.instruction || "Apply these annotations to the slide.",
    ].join("\n"),
    submit: true,
  };
}

export type ContextToolbarQuickPick =
  | "tightenTone"
  | "polish"
  | "translate"
  | "makeMoreVisual"
  | "generateImage"
  | "removeBackground";

// Agent-facing instructions, not UI copy: the visible labels are localized.
const QUICK_PICK_INSTRUCTIONS: Record<ContextToolbarQuickPick, string> = {
  tightenTone: "Tighten the tone of the selected text: shorter, more direct.", // i18n-ignore agent prompt
  polish: "Polish the selected text: fix grammar and flow, keep the meaning.", // i18n-ignore agent prompt
  translate:
    "Translate the selected text. Ask which language if it is not obvious.", // i18n-ignore agent prompt
  makeMoreVisual:
    "Make the selected content more visual: replace prose with a clearer layout, diagram, or imagery.", // i18n-ignore agent prompt
  generateImage: "Generate a new image to replace the selected image.", // i18n-ignore agent prompt
  removeBackground: "Remove the background from the selected image.", // i18n-ignore agent prompt
};

export function buildQuickPickPrompt(args: {
  pick: ContextToolbarQuickPick;
  slideNumber: number;
  slideId: string;
  selectors: readonly string[];
}): EditorAgentPrompt {
  return {
    message: [
      `[Current selection on slide ${args.slideNumber} (${args.slideId}): ${args.selectors.join(", ")}]`,
      QUICK_PICK_INSTRUCTIONS[args.pick],
    ].join("\n"),
    submit: true,
  };
}

export function openAgentPanel(): void {
  window.dispatchEvent(new Event("agent-panel:open"));
}

export function sendEditorPromptToAgent(prompt: EditorAgentPrompt): void {
  sendToAgentChat({
    message: prompt.message,
    submit: prompt.submit,
    chatTarget: "local",
  });
}
