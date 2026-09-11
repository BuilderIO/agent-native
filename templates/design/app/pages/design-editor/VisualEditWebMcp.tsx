import { defineClientAction } from "@agent-native/core/client/host";
import { createAgentNativeWebMcpRegistration } from "@agent-native/core/client/webmcp";
import { useEffect, useRef } from "react";

export interface VisualEditPromptResult {
  designId: string | null;
  pendingEditCount: number;
  status: "ready" | "empty";
  prompt: string;
}

export function createVisualEditWebMcpActions(args: {
  getPrompt: () => VisualEditPromptResult;
}) {
  return [
    defineClientAction<Record<string, never>, VisualEditPromptResult>({
      name: "get-visual-edit-prompt",
      title: "Get visual edit prompt", // i18n-ignore stable WebMCP tool title
      description: // i18n-ignore stable WebMCP tool description
        "Return the latest precise instructions for applying pending visual edits from this Design canvas to the connected app source.",
      schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      run: () => args.getPrompt(),
    }),
  ];
}

export function VisualEditWebMcp({
  getPrompt,
}: {
  getPrompt: () => VisualEditPromptResult;
}) {
  const getPromptRef = useRef(getPrompt);
  getPromptRef.current = getPrompt;

  useEffect(() => {
    const registration = createAgentNativeWebMcpRegistration({
      actions: createVisualEditWebMcpActions({
        getPrompt: () => getPromptRef.current(),
      }),
    });
    void registration.start().catch(() => {
      // WebMCP is progressive enhancement; the copy-to-clipboard path remains available.
    });
    return () => registration.stop();
  }, []);

  return null;
}
