import { useT } from "@agent-native/core/client";
import { useCallback } from "react";
import { toast } from "sonner";

import { sendToDesignAgentChat } from "@/lib/agent-chat";

export interface AgentEditRequestArgs {
  /** Freeform user message describing the edit to make. */
  message: string;
  /** CSS selector or data-agent-native-node-id identifying the target element. */
  selector?: string;
  /** Source id (data-code-layer-id) of the target element. */
  sourceId?: string;
  /** The design file id (screen / file row id) being edited. */
  fileId?: string;
  /** The design id (row id of the design). */
  designId?: string;
  /** For localhost-connected screens: the source file path to route edits through. */
  routeSourceFile?: string;
  /** Human-readable filename for context (e.g. "index.html"). */
  filename?: string;
}

/**
 * Builds the hidden agent context string for an edit request, following the
 * same pattern used by the tweaks panel (DesignEditor.tsx ~5293) and the
 * extensions panel context builder (DesignExtensionsPanel.tsx ~120-131).
 */
function buildEditContext(args: AgentEditRequestArgs): string {
  const lines: string[] = [];

  if (args.designId) {
    lines.push(`Design id: "${args.designId}".`);
  }
  if (args.fileId) {
    lines.push(
      args.filename
        ? `Active file: "${args.filename}" (file id: "${args.fileId}").`
        : `Active file id: "${args.fileId}".`,
    );
  } else if (args.filename) {
    lines.push(`Active file: "${args.filename}".`);
  }
  if (args.selector) {
    lines.push(`Selected element CSS selector: "${args.selector}".`);
  }
  if (args.sourceId) {
    lines.push(
      `Selected element source id (data-code-layer-id): "${args.sourceId}".`,
    );
  }
  if (args.routeSourceFile) {
    lines.push(
      `Localhost source file to route edits through: "${args.routeSourceFile}".`,
    );
  }

  lines.push("");
  lines.push("Agent instructions:");
  lines.push(
    "1. Call view-screen first to see the current state of the design.",
  );
  lines.push(
    "2. For style, class, text, or positional changes on the selected element, prefer apply-visual-edit — it is deterministic and does not require a full regeneration.",
  );
  lines.push(
    "3. For structural changes, new sections, or multi-element edits, use edit-design (search/replace) for small targeted changes or generate-design for full rewrites.",
  );
  lines.push(
    "4. If a routeSourceFile is provided, the design screen is connected to localhost source code. Route edits through the agent code editing surface for that file rather than modifying the inline HTML prototype.",
  );

  return lines.join("\n");
}

/**
 * Builds the full pasteable prompt string (visible message + context block)
 * for use in the "Copy prompt" flow.
 */
function buildFullPrompt(args: AgentEditRequestArgs): string {
  const context = buildEditContext(args);
  return `${args.message}\n\n---\n${context}`;
}

export interface UseAgentEditRequestReturn {
  /**
   * Routes the edit request directly to the agent chat sidebar.
   * The message is shown in the chat; the context is hidden.
   */
  sendEdit: (args: AgentEditRequestArgs) => Promise<void>;
  /**
   * Builds the same prompt+context as a single string and copies it to the
   * clipboard. Toasts success or blocked per the pattern in DesignEditor.tsx ~7608.
   */
  copyPrompt: (args: AgentEditRequestArgs) => Promise<void>;
}

/**
 * Shared hook for routing AI edit requests from the inspector and the
 * local-source banner. Reuses the Design-local chat bridge and the
 * clipboard+toast pattern established in DesignEditor.tsx.
 */
export function useAgentEditRequest(): UseAgentEditRequestReturn {
  const t = useT();

  const sendEdit = useCallback(
    async (args: AgentEditRequestArgs): Promise<void> => {
      const context = buildEditContext(args);
      sendToDesignAgentChat({
        message: args.message,
        context,
        submit: true,
        openSidebar: true,
      });
    },
    [],
  );

  const copyPrompt = useCallback(
    async (args: AgentEditRequestArgs): Promise<void> => {
      const text = buildFullPrompt(args);
      try {
        await navigator.clipboard.writeText(text);
        toast.success(t("designEditor.toasts.codingHandoffCopied"));
      } catch {
        toast.error(t("designEditor.toasts.clipboardBlocked"));
      }
    },
    [t],
  );

  return { sendEdit, copyPrompt };
}
