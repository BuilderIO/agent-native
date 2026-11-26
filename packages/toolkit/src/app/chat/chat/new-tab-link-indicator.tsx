import { useT } from "@agent-native/core/client/i18n";
import { IconExternalLink } from "@tabler/icons-react";

/** Trailing icon and screen-reader hint for a chat link that opens a new tab. */
export function NewTabLinkIndicator() {
  const t = useT();
  return (
    <>
      <IconExternalLink
        size="0.85em"
        strokeWidth={2}
        aria-hidden="true"
        data-new-tab-indicator=""
        className="ms-0.5 inline-block align-[-0.1em]"
      />
      <span className="sr-only">{t("agentChat.markdown.opensInNewTab")}</span>
    </>
  );
}
