import { useT } from "@agent-native/core/client/i18n";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import type { ShareSendTo } from "@agent-native/toolkit/app/sharing";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { useNavigate } from "react-router";
import { toast } from "sonner";

/**
 * The Share panel's Send to menu for a deck: the link Copy link does not
 * cover, and where to connect an agent. The shared panel adds the deck's
 * agent link itself.
 */
export function useDeckShareSendTo(
  secondaryLink: { url: string; copyLabel: string } | undefined,
): ShareSendTo {
  const t = useT();
  const navigate = useNavigate();
  return {
    items: secondaryLink
      ? [
          {
            id: "secondary-link",
            label: secondaryLink.copyLabel,
            onSelect: () => {
              void writeClipboardText(secondaryLink.url).then((copied) => {
                if (copied) toast.success(t("editorToolbar.linkCopied"));
                else toast.error(t("editorToolbar.linkCopyFailed"));
              });
            },
          },
        ]
      : [],
    openMcpSettings: () => void navigate(buildSettingsRoute("mcp")),
  };
}
