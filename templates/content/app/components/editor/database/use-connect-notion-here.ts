import { useT } from "@agent-native/core/client/i18n";
import { openOAuthPopup } from "@agent-native/core/client/oauth-popup";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { openNotionOAuthUrl, useNotionConnection } from "@/hooks/use-notion";

const POLL_MS = 2_000;
/** How long sign-in may take before this stops looking for it. */
const POLL_TIMEOUT_MS = 5 * 60_000;

/**
 * Signs in to Notion from where the user is, in a pop-up, and watches for
 * the connection so the list of databases fills in without leaving the panel.
 * `isConnected` reads whether Notion is connected now.
 */
export function useConnectNotionHere(isConnected: () => Promise<boolean>) {
  const t = useT();
  const { data: connection } = useNotionConnection();
  const [connecting, setConnecting] = useState(false);
  const poll = useRef<number | undefined>(undefined);
  const timeout = useRef<number | undefined>(undefined);
  const stop = () => {
    window.clearInterval(poll.current);
    window.clearTimeout(timeout.current);
    poll.current = undefined;
    timeout.current = undefined;
    setConnecting(false);
  };
  useEffect(
    () => () => {
      window.clearInterval(poll.current);
      window.clearTimeout(timeout.current);
    },
    [],
  );

  async function start() {
    if (connection?.error === "missing_credentials") {
      toast.error(t("sidebar.notionOAuthNotConfigured"));
      return;
    }
    const popup = openOAuthPopup();
    if (!popup) {
      toast.error(t("sidebar.notionOAuthNotConfigured"));
      return;
    }
    popup.opener = null;
    try {
      popup.location.href = await openNotionOAuthUrl();
    } catch (error) {
      popup.close();
      toast.error(
        error instanceof Error
          ? error.message
          : t("sidebar.notionOAuthNotConfigured"),
      );
      return;
    }
    stop();
    setConnecting(true);
    poll.current = window.setInterval(() => {
      if (popup.closed) {
        // Closed or cancelled. One last look, in case sign-in finished as it closed.
        stop();
        void isConnected();
        return;
      }
      if (document.hidden) return;
      void isConnected().then((connected) => {
        if (connected) stop();
      });
    }, POLL_MS);
    timeout.current = window.setTimeout(stop, POLL_TIMEOUT_MS);
  }

  return { connecting, start };
}
