import { trackEvent } from "@agent-native/core/client/analytics";
import { useT } from "@agent-native/core/client/i18n";
import { useActionMutation } from "@agent-native/core/client/use-action";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { ActionButton } from "@agent-native/toolkit/design-system";
import {
  ShareAgentsSection,
  ShareCopyRow,
} from "@agent-native/toolkit/sharing";
import { useCallback, useState } from "react";

import {
  agentLinkExpiresAt,
  isAgentLinkExpiring,
} from "./agent-link-expiry.js";

interface AgentResourceLink {
  contextUrl?: string;
  expiresAt?: string;
}

export interface AgentShareSectionProps {
  resourceType: string;
  resourceId: string;
  enabled?: boolean;
  className?: string;
  label?: string;
}

export function AgentShareSection({
  resourceType,
  resourceId,
  enabled = false,
  className,
  label,
}: AgentShareSectionProps) {
  const t = useT();
  const createAgentLink = useActionMutation<
    AgentResourceLink,
    { resourceType: string; resourceId: string }
  >("create-agent-resource-link");
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<{
    url: string;
    expiresAt: number | null;
  } | null>(null);
  const [linkError, setLinkError] = useState(false);

  const loadContextUrl = useCallback(() => {
    setLink(null);
    setLinkError(false);
    createAgentLink.mutate(
      { resourceType, resourceId },
      {
        onSuccess: (result) => {
          if (result.contextUrl) {
            setLink({
              url: result.contextUrl,
              expiresAt: agentLinkExpiresAt(result.expiresAt),
            });
          } else setLinkError(true);
        },
        onError: () => setLinkError(true),
      },
    );
  }, [createAgentLink, resourceId, resourceType]);

  const handleCopy = useCallback(
    async (value: string) => {
      // A link left open past its expiry would copy dead; fetch a fresh one to copy instead.
      if (link && isAgentLinkExpiring(link.expiresAt)) {
        loadContextUrl();
        return false;
      }
      const copied = await writeClipboardText(value);
      if (copied) {
        trackEvent("share_link_copied", {
          resource_type: resourceType,
          resource_id: resourceId,
          link_type: "agent_context",
        });
      }
      return copied;
    },
    [link, loadContextUrl, resourceId, resourceType],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen && (!link || isAgentLinkExpiring(link.expiresAt))) {
        loadContextUrl();
      }
    },
    [link, loadContextUrl],
  );

  if (!enabled) return null;

  return (
    <ShareAgentsSection
      label={
        label ??
        t("agentChat.share.shareWithAgents", {
          defaultValue: "Share with agents",
        })
      }
      open={open}
      onOpenChange={handleOpenChange}
      className={className}
    >
      <div className="space-y-2">
        {link ? (
          <ShareCopyRow
            label={t("agentChat.share.agentContext", {
              defaultValue: "Agent context link",
            })}
            description={t("agentChat.share.agentContextDescription", {
              defaultValue: "Read-only context for an external agent.",
            })}
            value={link.url}
            copyLabel={t("agentChat.share.copy", { defaultValue: "Copy" })}
            copiedLabel={t("agentChat.share.copied", {
              defaultValue: "Copied",
            })}
            onCopy={handleCopy}
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
