import { agentNativePath } from "@agent-native/core/client/api-path";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useLabState } from "@agent-native/core/client/labs/use-lab";
import { openOAuthPopup } from "@agent-native/core/client/oauth-popup";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { IconDots, IconPlus, IconTrash } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { SettingsRow } from "../SettingsRow.js";
import { isPopupClosed } from "../useBuilderStatus.js";

const K = "agentChat.settingsModel.";
const CONNECTED_MESSAGE = "agent-native-chatgpt-subscription-connected";
// The callback page posts CONNECTED_MESSAGE before it closes itself, so a
// popup that closes without one is a cancelled sign-in and needs no grace
// period before the button recovers.
const POPUP_POLL_MS = 500;

export interface ChatGPTSubscriptionStatus {
  supported: boolean;
  supportReason: "requires_local_loopback" | "requires_lab" | null;
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

/** The viewer's ChatGPT plan access, shared by the row and the Model page. */
export function useChatGPTSubscriptionStatus() {
  const lab = useLabState("chatgpt-subscription");
  return useActionQuery<ChatGPTSubscriptionStatus>(
    "get-chatgpt-subscription-status" as never,
    undefined,
    { enabled: lab.enabled },
  );
}

/** Personal providers › ChatGPT plan access. */
export function ChatGPTSubscriptionRow() {
  const t = useT();
  const queryClient = useQueryClient();
  const lab = useLabState("chatgpt-subscription");
  const status = useChatGPTSubscriptionStatus();
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  // Shown as the switcher's value until the status read catches up.
  const [pendingAccountId, setPendingAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  const popupRef = useRef<Window | null>(null);

  const { refetch } = status;
  const finish = useCallback(() => {
    popupRef.current = null;
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
      window.clearInterval(timer);
      finish();
    }, POPUP_POLL_MS);
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
      await queryClient.invalidateQueries({ queryKey: ["action"] });
      window.dispatchEvent(new CustomEvent("agent-engine:configured-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDisconnecting(false);
      setConfirmingDisconnect(false);
    }
  };

  const selectAccount = async (accountId: string) => {
    setError(null);
    setPendingAccountId(accountId);
    try {
      await callAction(
        "select-chatgpt-subscription-account" as never,
        { accountId } as never,
      );
      await refetch();
      void queryClient.invalidateQueries({ queryKey: ["action"] });
      window.dispatchEvent(new CustomEvent("agent-engine:configured-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAccountId(null);
    }
  };

  const data = status.data;
  const connected = data?.connected === true;
  const supported = data?.supported === true;
  const activeAccount = data?.activeAccount ?? null;
  // Accounts the agent can use now; signed-out ones are reconnected, not chosen.
  const switchable = (data?.accounts ?? []).filter(
    (account) => account.connected && account.planUsageEnabled,
  );
  const removeLegacyButton = data?.legacyRegistrationCleanupAvailable ? (
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

  let control: ReactNode;
  if (!data) {
    control = status.isError ? null : <Skeleton className="h-8 w-40" />;
  } else if (!supported) {
    control = removeLegacyButton;
  } else if (connected) {
    control = (
      <div className="flex min-w-0 items-center gap-2">
        {switchable.length > 1 ? (
          <Select
            value={pendingAccountId ?? data.activeAccountId ?? undefined}
            onValueChange={(accountId) => void selectAccount(accountId)}
            disabled={pendingAccountId !== null || disconnecting}
          >
            <SelectTrigger
              size="sm"
              className="w-52 max-w-full"
              aria-label={t(`${K}chatgptSelectAccount`)}
            >
              <SelectValue placeholder={t(`${K}chatgptSelectAccount`)} />
            </SelectTrigger>
            <SelectContent>
              {switchable.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="truncate text-sm text-muted-foreground">
            {activeAccount?.label}
          </span>
        )}
        {connecting ? (
          <span
            role="status"
            className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground"
          >
            <Spinner />
            {t(`${K}chatgptConnecting`)}
          </span>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t(`${K}manage`)}
                disabled={disconnecting}
              >
                <IconDots aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => connect()}>
                <IconPlus className="size-4" aria-hidden />
                {t(`${K}chatgptAddAccount`)}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setConfirmingDisconnect(true)}
                className="text-destructive focus:text-destructive"
              >
                <IconTrash className="size-4" aria-hidden />
                {t(`${K}chatgptDisconnect`)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  } else {
    control = (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={connecting}
          onClick={() => connect(activeAccount?.id)}
        >
          {connecting ? <Spinner /> : null}
          {connecting
            ? t(`${K}chatgptConnecting`)
            : data.reconnectRequired || activeAccount
              ? t(`${K}chatgptReconnect`)
              : t(`${K}chatgptContinue`)}
        </Button>
        {removeLegacyButton}
      </div>
    );
  }

  const noDirectUse =
    !!data &&
    supported &&
    !connected &&
    !!activeAccount &&
    !activeAccount.planUsageEnabled;
  const legacySignIn = data?.legacyRegistrationCleanupAvailable === true;
  const failed = !!error || status.isError;

  if (!lab.enabled) return null;

  return (
    <>
      <SettingsRow
        id="chatgpt-subscription"
        label={t(`${K}chatgptTitle`)}
        status={
          connected ? (
            <Badge variant="outline">{t(`${K}chatgptConnected`)}</Badge>
          ) : null
        }
        description={data && !supported ? t(`${K}chatgptLocalOnly`) : undefined}
        control={control}
      >
        {noDirectUse || legacySignIn || failed || notice ? (
          <div className="grid gap-2 text-sm">
            {noDirectUse ? (
              <p className="text-muted-foreground">
                {t(`${K}chatgptNoDirectUse`)}
              </p>
            ) : null}
            {legacySignIn ? (
              <p className="text-muted-foreground">
                {t(`${K}chatgptLegacySignInDetails`)}
              </p>
            ) : null}
            {failed ? (
              <p role="alert" className="text-destructive">
                {error ?? t(`${K}settingLoadFailed`)}
              </p>
            ) : null}
            {notice ? (
              <p role="status" className="text-muted-foreground">
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
          </div>
        ) : null}
      </SettingsRow>
      <AlertDialog
        open={confirmingDisconnect}
        onOpenChange={(open) => {
          if (!disconnecting) setConfirmingDisconnect(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(`${K}chatgptDisconnectTitle`)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${K}chatgptDisconnectDescription`, {
                account: activeAccount?.label ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={disconnecting}
              onClick={() => setConfirmingDisconnect(false)}
            >
              {t(`${K}cancel`)}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={disconnecting}
              onClick={() => void disconnect(activeAccount?.id)}
            >
              {disconnecting ? <Spinner /> : null}
              {disconnecting
                ? t(`${K}chatgptDisconnecting`)
                : t(`${K}chatgptDisconnect`)}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
