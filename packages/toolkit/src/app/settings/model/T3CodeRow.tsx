import { agentNativePath } from "@agent-native/core/client/api-path";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  watchWorkspaceConnectionCompletion,
  WORKSPACE_CONNECTION_COMPLETION_RETURN,
} from "@agent-native/core/client/integrations";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { IconDots, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { SettingsRow } from "../SettingsRow.js";

const K = "agentChat.settingsModel.";
export const T3_CODE_LAB = "t3-code-agents";

export interface T3CodeAgent {
  kind: "claude-code" | "codex";
  name: string;
  providerInstanceId: string;
  model: string;
}

export interface T3CodeStatus {
  state: "disconnected" | "connected" | "reconnect" | "unreachable";
  url?: string;
  computer?: string;
  access?: "read" | "operate";
  agents: T3CodeAgent[];
  expiresAt?: number;
}

type AddressCheck =
  | { ok: true; url: string }
  | { ok: false; reason: "http" | "invalid" | "not-mcp" | "unreachable" };

const ADDRESS_ERROR_KEYS: Record<
  Exclude<AddressCheck, { ok: true }>["reason"],
  string
> = {
  http: "t3CodeAddressHttp",
  invalid: "t3CodeAddressInvalid",
  "not-mcp": "t3CodeAddressNotMcp",
  unreachable: "t3CodeAddressUnreachable",
};

/** The viewer's T3 Code connection, shared by the row and comment menus. */
export function useT3CodeStatus() {
  const lab = useLabState(T3_CODE_LAB);
  return useActionQuery<T3CodeStatus>(
    "get-t3-code-status" as never,
    undefined,
    {
      enabled: lab.enabled,
    },
  );
}

function Pill({ children }: { children: string }) {
  return (
    <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

/** Personal providers › T3 Code: tag your own Claude Code and Codex. */
export function T3CodeRow() {
  const t = useT();
  const queryClient = useQueryClient();
  const lab = useLabState(T3_CODE_LAB);
  const status = useT3CodeStatus();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [checking, setChecking] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopWatching = useRef<(() => void) | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => () => stopWatching.current?.(), []);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["action"] });
  };

  const openDialog = () => {
    setError(null);
    setAddressError(null);
    setAddress(status.data?.url ?? "");
    setDialogOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAddressError(null);
    const url = address.trim();
    if (!url) return;
    const popup = openOAuthPopup({ features: "popup,width=520,height=720" });
    if (!popup) {
      setAddressError(t(`${K}chatgptPopupBlocked`));
      return;
    }
    setChecking(true);
    let check: AddressCheck;
    try {
      check = (await callAction(
        "check-t3-code-address" as never,
        { url } as never,
      )) as AddressCheck;
    } catch (err) {
      popup.close();
      setChecking(false);
      setAddressError(err instanceof Error ? err.message : String(err));
      return;
    }
    setChecking(false);
    if (!check.ok) {
      popup.close();
      setAddressError(t(`${K}${ADDRESS_ERROR_KEYS[check.reason]}`));
      return;
    }
    const params = new URLSearchParams({
      purpose: "t3-code",
      url: check.url,
      name: "T3 Code",
      return: WORKSPACE_CONNECTION_COMPLETION_RETURN,
    });
    popup.location.href = new URL(
      agentNativePath(`/_agent-native/mcp/servers/oauth/start?${params}`),
      window.location.href,
    ).href;
    setDialogOpen(false);
    setConnecting(true);
    stopWatching.current?.();
    const done = () => {
      stopWatching.current?.();
      stopWatching.current = null;
      setConnecting(false);
      void refresh();
    };
    const stop = watchWorkspaceConnectionCompletion(popup, done);
    const closed = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(closed);
      done();
    }, 1_000);
    stopWatching.current = () => {
      stop();
      window.clearInterval(closed);
    };
  };

  const disconnect = async () => {
    setError(null);
    setDisconnecting(true);
    try {
      await callAction("disconnect-t3-code" as never, {} as never);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDisconnecting(false);
      setConfirmingDisconnect(false);
    }
  };

  if (!lab.enabled) return null;

  const data = status.data;
  const connected = data?.state === "connected";
  const linked = !!data && data.state !== "disconnected";

  const control = !data ? (
    status.isError ? null : (
      <Skeleton className="h-8 w-28" />
    )
  ) : connecting ? (
    <span
      role="status"
      className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground"
    >
      <Spinner />
      {t(`${K}chatgptConnecting`)}
    </span>
  ) : linked ? (
    <div className="flex items-center gap-2">
      {data.state === "reconnect" ? (
        <Button type="button" variant="outline" size="sm" onClick={openDialog}>
          {t(`${K}chatgptReconnect`)}
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
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
          <DropdownMenuItem onSelect={openDialog}>
            <IconRefresh className="size-4" aria-hidden />
            {t(`${K}chatgptReconnect`)}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setConfirmingDisconnect(true)}
            className="text-destructive focus:text-destructive"
          >
            <IconTrash className="size-4" aria-hidden />
            {t(`${K}chatgptDisconnect`)}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ) : (
    <Button type="button" variant="outline" size="sm" onClick={openDialog}>
      {t(`${K}t3CodeConnect`)}
    </Button>
  );

  const signInAgain =
    connected && data.expiresAt
      ? new Date(data.expiresAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })
      : null;

  return (
    <>
      <SettingsRow
        id="t3-code"
        label={t(`${K}t3CodeTitle`)}
        status={
          connected ? (
            <Badge variant="outline">{t(`${K}chatgptConnected`)}</Badge>
          ) : null
        }
        description={t(`${K}t3CodeDescription`)}
        control={control}
      >
        {linked || error || status.isError ? (
          <div className="grid gap-2 text-sm">
            {connected ? (
              <div className="flex flex-wrap gap-1.5">
                {data.computer ? <Pill>{data.computer}</Pill> : null}
                <Pill>
                  {t(
                    `${K}${data.access === "operate" ? "t3CodeCanStart" : "t3CodeReadOnly"}`,
                  )}
                </Pill>
                {data.agents.map((agent) => (
                  <Pill key={agent.kind}>{agent.name}</Pill>
                ))}
              </div>
            ) : null}
            {connected && data.access !== "operate" ? (
              <p className="text-muted-foreground">
                {t(`${K}t3CodeReadOnlyHint`)}
              </p>
            ) : null}
            {connected && data.agents.length === 0 ? (
              <p className="text-muted-foreground">{t(`${K}t3CodeNoAgents`)}</p>
            ) : null}
            {signInAgain ? (
              <p className="text-muted-foreground">
                {t(`${K}t3CodeSignInAgain`, { date: signInAgain })}
              </p>
            ) : null}
            {data?.state === "reconnect" ? (
              <p className="text-muted-foreground">
                {t(`${K}t3CodeReconnectHint`)}
              </p>
            ) : null}
            {data?.state === "unreachable" ? (
              <p role="alert" className="text-destructive">
                {t(`${K}t3CodeUnreachable`)}
              </p>
            ) : null}
            {error || status.isError ? (
              <p role="alert" className="text-destructive">
                {error ?? t(`${K}settingLoadFailed`)}
              </p>
            ) : null}
          </div>
        ) : null}
      </SettingsRow>
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!checking) setDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={(event) => void submit(event)} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t(`${K}t3CodeDialogTitle`)}</DialogTitle>
              <DialogDescription>
                {t(`${K}t3CodeDialogDescription`)}
              </DialogDescription>
            </DialogHeader>
            <ol className="grid list-decimal gap-1 pl-5 text-sm text-muted-foreground">
              <li>{t(`${K}t3CodeDialogStep1`)}</li>
              <li>{t(`${K}t3CodeDialogStep2`)}</li>
            </ol>
            <div className="grid gap-1.5">
              <Label htmlFor="t3-code-address">
                {t(`${K}t3CodeAddressLabel`)}
              </Label>
              <Input
                id="t3-code-address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="https://…/mcp"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                aria-invalid={addressError ? true : undefined}
                aria-describedby={
                  addressError ? "t3-code-address-error" : "t3-code-access"
                }
                autoFocus
              />
              {addressError ? (
                <p
                  id="t3-code-address-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {addressError}
                </p>
              ) : null}
              <p id="t3-code-access" className="text-xs text-muted-foreground">
                {t(`${K}t3CodeAccessHint`)}
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={checking}
                onClick={() => setDialogOpen(false)}
              >
                {t(`${K}cancel`)}
              </Button>
              <Button type="submit" disabled={checking || !address.trim()}>
                {checking ? <Spinner /> : null}
                {checking ? t(`${K}t3CodeChecking`) : t(`${K}t3CodeContinue`)}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={confirmingDisconnect}
        onOpenChange={(open) => {
          if (!disconnecting) setConfirmingDisconnect(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(`${K}t3CodeDisconnectTitle`)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${K}t3CodeDisconnectDescription`)}
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
              onClick={() => void disconnect()}
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
