
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

export function sendEditorPromptToAgent(prompt: EditorAgentPrompt): void {
  sendToAgentChat({
    message: prompt.message,
    submit: prompt.submit,
    chatTarget: "local",
  });
}
