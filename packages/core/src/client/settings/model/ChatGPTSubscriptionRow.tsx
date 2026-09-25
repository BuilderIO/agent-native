import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { agentNativePath } from "../../api-path.js";
import { useT } from "../../i18n.js";
import { openOAuthPopup } from "../../oauth-popup.js";
import { callAction, useActionQuery } from "../../use-action.js";
import { SettingsRow } from "../SettingsRow.js";
import {
  isPopupClosed,
  POPUP_CLOSED_CONFIRMATION_GRACE_MS,
} from "../useBuilderStatus.js";

const K = "agentChat.settingsModel.";
const CONNECTED_MESSAGE = "agent-native-chatgpt-subscription-connected";

interface ChatGPTSubscriptionStatus {
  connected: boolean;
  reconnectRequired: boolean;
}

/** Personal providers › ChatGPT subscription, shown while its lab is on. */
export function ChatGPTSubscriptionRow() {
  const t = useT();
  const queryClient = useQueryClient();
  const status = useActionQuery<ChatGPTSubscriptionStatus>(
    "get-chatgpt-subscription-status" as never,
  );
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const popupClosedAtRef = useRef<number | null>(null);

  const { refetch } = status;
  const finish = useCallback(() => {
    popupRef.current = null;
    popupClosedAtRef.current = null;
    setConnecting(false);
    void refetch();
    window.dispatchEvent(new CustomEvent("agent-engine:configured-changed"));
  }, [refetch]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.data?.type === CONNECTED_MESSAGE
      ) {
        finish();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [finish]);

  useEffect(() => {
    if (!connecting) return;
    const timer = window.setInterval(() => {
      if (!isPopupClosed(popupRef.current)) return;
      popupClosedAtRef.current ??= Date.now();
      if (
        Date.now() - popupClosedAtRef.current <=
        POPUP_CLOSED_CONFIRMATION_GRACE_MS
      ) {
        return;
      }
      window.clearInterval(timer);
      finish();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [connecting, finish]);

  const connect = () => {
    setError(null);
    const popup = openOAuthPopup({
      initialUrl: agentNativePath(
        "/_agent-native/agent-engine/chatgpt-subscription/start",
      ),
      features: "popup,width=520,height=720",
    });
    if (!popup) {
      setError(t(`${K}chatgptPopupBlocked`));
      return;
    }
    popupRef.current = popup;
    popupClosedAtRef.current = null;
    setConnecting(true);
  };

  const disconnect = async () => {
    setError(null);
    setDisconnecting(true);
    try {
      await callAction("disconnect-chatgpt-subscription" as never, {} as never);
      void queryClient.invalidateQueries({ queryKey: ["action"] });
      window.dispatchEvent(new CustomEvent("agent-engine:configured-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDisconnecting(false);
    }
  };

  const connected = status.data?.connected === true;
  const control = connected ? (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="h-8 px-3"
      disabled={disconnecting}
      onClick={() => void disconnect()}
    >
      {t(`${K}disconnect`)}
    </Button>
  ) : (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="h-8 px-3"
      disabled={connecting || !status.data}
      onClick={connect}
    >
      {connecting
        ? t(`${K}connecting`)
        : status.data?.reconnectRequired
          ? t(`${K}reconnect`)
          : t(`${K}connect`)}
    </Button>
  );

  return (
    <SettingsRow
      id="chatgpt-subscription"
      label={t(`${K}chatgptTitle`)}
      status={<Badge variant="outline">{t(`${K}labs`)}</Badge>}
      description={
        connected ? t(`${K}chatgptConnected`) : t(`${K}chatgptDescription`)
      }
      control={control}
    >
      {error || status.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {error ?? t(`${K}settingLoadFailed`)}
        </p>
      ) : null}
    </SettingsRow>
  );
}
