import { agentNativePath } from "@agent-native/core/client/api-path";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { openOAuthPopup } from "@agent-native/core/client/oauth-popup";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { SettingsRow } from "../SettingsRow.js";
import {
  isPopupClosed,
  POPUP_CLOSED_CONFIRMATION_GRACE_MS,
} from "../useBuilderStatus.js";

const K = "agentChat.settingsModel.";
const CONNECTED_MESSAGE = "agent-native-chatgpt-subscription-connected";

interface ChatGPTSubscriptionStatus {
  supported: boolean;
  supportReason: "requires_local_loopback" | null;
  connected: boolean;
  reconnectRequired: boolean;
  activeAccountId: string | null;
  activeAccount: ChatGPTSubscriptionAccount | null;
  accounts: ChatGPTSubscriptionAccount[];
  legacyRegistrationCleanupAvailable: boolean;
}

interface ChatGPTSubscriptionAccount {
  id: string;
  email: string | null;
  label: string;
  connected: boolean;
  reconnectRequired: boolean;
  planUsageEnabled: boolean;
  active: boolean;
}

/** Personal providers › ChatGPT plan access. */
export function ChatGPTSubscriptionRow() {
  const t = useT();
  const queryClient = useQueryClient();
  const status = useActionQuery<ChatGPTSubscriptionStatus>(
    "get-chatgpt-subscription-status" as never,
  );
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
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

  const connect = (accountId?: string) => {
    setError(null);
    setNotice(false);
    const popup = openOAuthPopup({
      initialUrl: agentNativePath(
        `/_agent-native/agent-engine/chatgpt-subscription/start${
          accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""
        }`,
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

  const disconnect = async (
    accountId?: string,
    removeLegacyCredential = false,
  ) => {
    setError(null);
    setNotice(false);
    setDisconnecting(true);
    try {
      const result = (await callAction(
        "disconnect-chatgpt-subscription" as never,
        removeLegacyCredential
          ? ({ removeLegacyCredential: true } as never)
          : accountId
            ? ({ accountId } as never)
            : ({} as never),
      )) as { remoteRevocationConfirmed?: boolean };
      setNotice(result.remoteRevocationConfirmed === false);
      void queryClient.invalidateQueries({ queryKey: ["action"] });
      window.dispatchEvent(new CustomEvent("agent-engine:configured-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDisconnecting(false);
    }
  };

  const selectAccount = async (accountId: string) => {
    setError(null);
    setSelecting(true);
    try {
      await callAction(
        "select-chatgpt-subscription-account" as never,
        { accountId } as never,
      );
      await status.refetch();
      void queryClient.invalidateQueries({ queryKey: ["action"] });
      window.dispatchEvent(new CustomEvent("agent-engine:configured-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSelecting(false);
    }
  };

  const connected = status.data?.connected === true;
  const activeAccount = status.data?.activeAccount ?? null;
  const supported = status.data?.supported === true;
  const removeLegacyButton = status.data?.legacyRegistrationCleanupAvailable ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disconnecting}
      onClick={() => void disconnect(undefined, true)}
    >
      {t(`${K}chatgptRemoveLegacySignIn`)}
    </Button>
  ) : null;
  const control = !status.data ? (
    <Skeleton className="h-8 w-40" />
  ) : !supported ? (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href="https://openai.com/form/sign-in-with-chatgpt-interest/"
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-8 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-accent"
      >
        {t(`${K}chatgptPartnerInterest`)}
      </a>
      {removeLegacyButton}
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      {status.data && status.data.accounts.length > 1 ? (
        <Select
          value={status.data.activeAccountId ?? undefined}
          onValueChange={(accountId) => void selectAccount(accountId)}
          disabled={selecting || disconnecting}
        >
          <SelectTrigger
            className="w-52"
            aria-label={t(`${K}chatgptSelectAccount`)}
          >
            <SelectValue placeholder={t(`${K}chatgptSelectAccount`)} />
          </SelectTrigger>
          <SelectContent>
            {status.data.accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {connected ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={connecting}
            onClick={() => connect()}
          >
            {t(`${K}chatgptAddAccount`)}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disconnecting}
            onClick={() => void disconnect(activeAccount?.id)}
          >
            {t(`${K}chatgptDisconnect`)}
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={connecting || !status.data}
          onClick={() => connect(activeAccount?.id)}
        >
          {connecting
            ? t(`${K}chatgptConnecting`)
            : status.data?.reconnectRequired || activeAccount
              ? t(`${K}chatgptReconnect`)
              : t(`${K}chatgptContinue`)}
        </Button>
      )}
      {removeLegacyButton}
    </div>
  );

  return (
    <SettingsRow
      id="chatgpt-subscription"
      label={t(`${K}chatgptTitle`)}
      status={
        connected ? (
          <Badge variant="outline">{t(`${K}chatgptConnected`)}</Badge>
        ) : null
      }
      control={control}
    >
      {!supported && status.data ? (
        <p className="text-sm text-muted-foreground">
          {t(`${K}chatgptLocalOnly`)}
        </p>
      ) : !connected && activeAccount && !activeAccount.planUsageEnabled ? (
        <p className="text-sm text-muted-foreground">
          {t(`${K}chatgptNoDirectUse`)}
        </p>
      ) : null}
      {status.data?.legacyRegistrationCleanupAvailable ? (
        <p className="text-sm text-muted-foreground">
          {t(`${K}chatgptLegacySignInDetails`)}
        </p>
      ) : null}
      {error || status.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {error ?? t(`${K}settingLoadFailed`)}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t(`${K}chatgptRemoteRevocationUnconfirmed`)}{" "}
          <a
            href="https://chatgpt.com/settings/usage"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary underline underline-offset-4"
          >
            {t(`${K}chatgptManageAccess`)}
          </a>
        </p>
      ) : null}
    </SettingsRow>
  );
}
