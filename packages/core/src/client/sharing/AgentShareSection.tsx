import { ActionButton } from "@agent-native/toolkit/design-system";
import {
  ShareAgentsSection,
  ShareCopyRow,
} from "@agent-native/toolkit/sharing";
import { useCallback, useState } from "react";

import { writeClipboardText } from "../clipboard.js";
import { useT } from "../i18n.js";
import { useActionMutation } from "../use-action.js";

interface AgentResourceLink {
  contextUrl?: string;
}

export interface AgentShareSectionProps {
  resourceType: string;
  resourceId: string;
  enabled?: boolean;
  className?: string;
}

/** Optional shared handoff for resources with a registered agent context. */
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
  const [open, setOpen] = useState(false);
  const [contextUrl, setContextUrl] = useState("");
  const [linkError, setLinkError] = useState(false);

  const loadContextUrl = useCallback(() => {
    setContextUrl("");
    setLinkError(false);
    createAgentLink.mutate(
      { resourceType, resourceId },
      {
        onSuccess: (result) => {
          if (result.contextUrl) setContextUrl(result.contextUrl);
          else setLinkError(true);
        },
        onError: () => setLinkError(true),
      },
    );
  }, [createAgentLink, resourceId, resourceType]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen && !contextUrl) loadContextUrl();
    },
    [contextUrl, loadContextUrl],
  );

  if (!enabled) return null;

  return (
    <ShareAgentsSection
      label={t("agentChat.share.shareWithAgents", {
        defaultValue: "Share with agents",
      })}
      open={open}
      onOpenChange={handleOpenChange}
      className={className}
    >
      <div className="space-y-2">
        {contextUrl ? (
          <ShareCopyRow
            label={t("agentChat.share.agentContext", {
              defaultValue: "Agent context link",
            })}
            description={t("agentChat.share.agentContextDescription", {
              defaultValue: "Read-only context for an external agent.",
            })}
            value={contextUrl}
            copyLabel={t("agentChat.share.copy", { defaultValue: "Copy" })}
            copiedLabel={t("agentChat.share.copied", {
              defaultValue: "Copied",
            })}
            onCopy={writeClipboardText}
          />
        ) : null}
        {createAgentLink.isPending ? (
          <div className="text-xs text-muted-foreground">
            {t("agentChat.share.preparingAgentLink", {
              defaultValue: "Preparing agent link...",
            })}
          </div>
        ) : null}
        {linkError ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
            <span className="text-xs text-muted-foreground">
              {t("agentChat.share.agentLinkUnavailable", {
                defaultValue: "Agent link unavailable.",
              })}
            </span>
            <ActionButton
              type="button"
              emphasis="ghost"
              size="compact"
              onPress={loadContextUrl}
              disabled={createAgentLink.isPending}
            >
              {t("agentChat.share.retryAgentLink", {
                defaultValue: "Retry",
              })}
            </ActionButton>
          </div>
        ) : null}
      </div>
    </ShareAgentsSection>
  );
}
