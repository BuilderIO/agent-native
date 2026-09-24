import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import type { ComposerContextSnapshot } from "@agent-native/toolkit/composer";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { persistComposerContext } from "@/lib/composer-context";

import { useDesignPromptContext } from "./use-design-prompt-context";

export function useDesignAgentComposer(designId?: string) {
  const [activeThreadId, setActiveThreadId] = useState("");
  const localSystems = useRef(new Map<string, string | null>());
  const [, setLocalRevision] = useState(0);
  const queryClient = useQueryClient();
  const { data: design } = useActionQuery<{ designSystemId: string | null }>(
    "get-design",
    { id: designId },
    { enabled: Boolean(designId) },
  );
  const selectedSystemId = designId
    ? design?.designSystemId
    : (localSystems.current.get(activeThreadId) ?? null);
  const changeSystem = async (systemId: string | null) => {
    if (!designId) {
      localSystems.current.set(activeThreadId, systemId);
      setLocalRevision((value) => value + 1);
      return;
    }
    queryClient.setQueryData(
      ["action", "get-design", { id: designId }],
      (old: Record<string, unknown> | undefined) =>
        old ? { ...old, designSystemId: systemId } : old,
    );
    try {
      await callAction("update-design", {
        id: designId,
        designSystemId: systemId,
      });
    } catch (error) {
      await queryClient.invalidateQueries({
        queryKey: ["action", "get-design", { id: designId }],
      });
      throw error;
    }
  };
  const context = useDesignPromptContext({
    designId,
    localScopeKey: activeThreadId,
    originScopeKey: `chat:${activeThreadId || "new"}`,
    selectedSystemId,
    onSystemChange: changeSystem,
  });
  return {
    context,
    selectedSystemId,
    composerProps: {
      onActiveThreadChange: setActiveThreadId,
      ...(!designId ? { composerContextThreadId: activeThreadId } : {}),
      composerContextItems: context.contextItems,
      composerContextMenuItems: context.contextMenuItems,
      onRemoveComposerContextItem: context.onRemoveContextItem,
      onInspectComposerContextItem: context.onInspectContextItem,
      onRetryComposerContextItem: context.onRetryContextItem,
      onBeforeComposerSubmit: async (items: ComposerContextSnapshot) => {
        await context.flush();
        if (designId) await persistComposerContext(designId, items);
        return true;
      },
    },
  };
}
