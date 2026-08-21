import { ActionButton } from "@agent-native/toolkit/design-system";
import { useCallback, useEffect, useRef, useState } from "react";

import { writeClipboardText } from "../clipboard.js";
import { useT } from "../i18n.js";
import { useActionMutation } from "../use-action.js";
import { cn } from "../utils.js";

interface AgentResourceLink {
  contextUrl?: string;
}

export interface AgentShareSectionProps {
  resourceType: string;
  resourceId: string;
  enabled?: boolean;
  className?: string;
}

/**
 * Optional agent handoff for resources with a registered agent context.
 * The link is created lazily — only when the person actually clicks Copy —
 * so opening the share surface never mints a token nobody asked for.
 */
export function AgentShareSection({
  resourceType,
  resourceId,
  enabled = false,
  className,
}: AgentShareSectionProps) {
  const t = useT();
  const createAgentLink = useActionMutation<
    AgentResourceLink,
    { resourceType: string; resourceId: string }
  >("create-agent-resource-link");
  const [contextUrl, setContextUrl] = useState("");
  const [linkError, setLinkError] = useState(false);
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const ensureContextUrl = useCallback((): Promise<string | null> => {
    if (contextUrl) return Promise.resolve(contextUrl);
    setLinkError(false);
    return new Promise((resolve) => {
      createAgentLink.mutate(
        { resourceType, resourceId },
        {
          onSuccess: (result) => {
            if (result.contextUrl) {
              setContextUrl(result.contextUrl);
              resolve(result.contextUrl);
            } else {
              setLinkError(true);
              resolve(null);
            }
          },
          onError: () => {
            setLinkError(true);
            resolve(null);
          },
        },
      );
    });
  }, [contextUrl, createAgentLink, resourceId, resourceType]);

  const handleCopy = useCallback(async () => {
    const url = await ensureContextUrl();
    if (!url) return;
    const didCopy = await writeClipboardText(url);
    if (!didCopy) return;
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1_400);
  }, [ensureContextUrl]);

  if (!enabled) return null;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-t border-border pt-4",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium">
          {t("agentChat.share.shareWithAgents", {
            defaultValue: "Share with agents",
          })}
        </div>
        <div className="text-xs text-muted-foreground">
          {t("agentChat.share.agentLinkExpiration", {
            defaultValue:
              "Temporary link to share with agent. Expires in 2 hours",
          })}
        </div>
        {linkError ? (
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("agentChat.share.agentLinkUnavailable", {
                defaultValue: "Agent link unavailable.",
              })}
            </span>
            <ActionButton
              type="button"
              emphasis="ghost"
              size="compact"
              onPress={() => void handleCopy()}
              disabled={createAgentLink.isPending}
              className="!h-auto !px-1 !py-0.5 text-xs"
            >
              {t("agentChat.share.retryAgentLink", { defaultValue: "Retry" })}
            </ActionButton>
          </div>
        ) : null}
      </div>
      <ActionButton
        type="button"
        emphasis="outline"
        size="compact"
        disabled={createAgentLink.isPending}
        pending={createAgentLink.isPending}
        onPress={() => void handleCopy()}
        className="h-9 shrink-0"
      >
        {copied
          ? t("agentChat.share.copied", { defaultValue: "Copied" })
          : t("agentChat.share.copy", { defaultValue: "Copy" })}
      </ActionButton>
    </div>
  );
}
