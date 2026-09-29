import { defineClientAction } from "@agent-native/core/client/host";
import { createAgentNativeWebMcpRegistration } from "@agent-native/core/client/webmcp";
import { useEffect, useRef } from "react";

export interface VisualEditPromptResult {
  designId: string | null;
  pendingEditCount: number;
  status: "ready" | "empty" | "session-ended" | "unknown";
  prompt: string;
}

export function hasNativeWebMcpHost(targetDocument?: Document): boolean {
  const doc =
    targetDocument ?? (typeof document === "undefined" ? undefined : document);
  if (!doc) return false;

  const hosts: Array<object | undefined> = [doc, doc.defaultView?.navigator];
  return hosts.some((host) => {
    if (!host) return false;
    return Boolean(
      (host as { modelContext?: unknown }).modelContext &&
      !Object.prototype.hasOwnProperty.call(host, "modelContext"),
    );
  });
}

export function createVisualEditWebMcpActions(args: {
  getPrompt: () => VisualEditPromptResult;
}) {
  return [
    defineClientAction<Record<string, never>, VisualEditPromptResult>({
      name: "get-visual-edit-prompt",
      title: "Pull visual edits from Design", // i18n-ignore stable WebMCP tool title
      description: // i18n-ignore stable WebMCP tool description
        "KEY HANDOFF: Pull the latest precise instructions for applying pending visual edits from this Design canvas to the connected app source. Use this before asking the user to copy or paste anything.",
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
