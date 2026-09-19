import {
  agentNativePath,
  appApiPath,
} from "@agent-native/core/client/api-path";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { SettingsGroup, SettingsRow } from "@agent-native/core/client/settings";
import { IconBrandSlack, IconLoader2, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface SlackInstallation {
  id: string;
  teamId: string;
  teamName: string | null;
  enterpriseName: string | null;
  apiAppId: string | null;
  ownerEmail: string;
  orgId: string | null;
  status: string;
  updatedAt: string;
}

interface SlackInstallationsResponse {
  oauthConfigured: boolean;
  signingConfigured: boolean;
  scopes: string[];
  installations: SlackInstallation[];
}

function absoluteAppUrl(url: string): string {
  const withBase = url.startsWith("/api/") ? appApiPath(url) : url;
  return new URL(withBase, window.location.origin).toString();
}

async function waitForPopupClose(popup: Window): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      window.removeEventListener("focus", onFocus);
      resolve();
    };
    const interval = window.setInterval(() => {
      if (popup.closed) finish();
    }, 500);
    const onFocus = () => {
      if (popup.closed) finish();
    };
    window.addEventListener("focus", onFocus);
    const timeout = window.setTimeout(finish, 5 * 60 * 1000);
  });
}

async function startSlackOAuth(): Promise<void> {
  const res = await fetch(
    agentNativePath("/_agent-native/actions/connect-slack?returnUrl=/settings"),
  );
  const text = await res.text();
  let data: {
    url?: string;
    error?: string;
    result?: { url?: string };
  } = {};
  try {
    data = JSON.parse(text);
    // coercion-ok: a non-JSON body still fails below on `!res.ok` or the missing URL.
  } catch {
    // Keep the fallback below.
  }
  if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
  const url = data.result?.url ?? data.url;
  if (!url) throw new Error("No Slack OAuth URL returned");
  const popup = window.open(
    absoluteAppUrl(url),
    "clips-slack-oauth",
    "width=600,height=760",
  );
  if (!popup) {
    throw new Error(
      "Popup blocked — please allow popups for this site and try again.",
    );
  }
  await waitForPopupClose(popup);
}

async function requestDisconnectSlack(id: string): Promise<void> {
  const res = await fetch(
    agentNativePath("/_agent-native/actions/disconnect-slack"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    },
  );
  if (!res.ok) {
    // coercion-ok: an error body may not be JSON; the failure is still raised with the status code.
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Disconnect failed (${res.status})`);
  }
}

export function SlackSection() {
  const t = useT();
  const slackStatus = useActionQuery<SlackInstallationsResponse>(
    "list-slack-installations",
    undefined,
    { retry: false },
  );
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectTarget, setDisconnectTarget] =
    useState<SlackInstallation | null>(null);

  const installations = slackStatus.data?.installations ?? [];
  const oauthConfigured = slackStatus.data?.oauthConfigured ?? false;
  const signingConfigured = slackStatus.data?.signingConfigured ?? false;
  const connected = installations.length > 0;

  async function handleConnect() {
    const beforeCount = installations.length;
    setConnecting(true);
    try {
      await startSlackOAuth();
      const refreshed = await slackStatus.refetch();
      const afterCount = refreshed.data?.installations?.length ?? beforeCount;
      if (afterCount > beforeCount) {
        toast.success(t("settings.slackConnectedToast"));
      } else {
        toast.message(t("settings.slackCheckedToast"));
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("settings.slackConnectFailed"),
      );
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    const target = disconnectTarget;
    if (!target) return;
    setDisconnecting(true);
    try {
      await requestDisconnectSlack(target.id);
      setDisconnectTarget(null);
      await slackStatus.refetch();
      toast.success(t("settings.slackDisconnectedToast"));
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("settings.slackDisconnectFailed"),
      );
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <>
      <SettingsGroup
        id="slack"
        title={t("settings.slackTitle")}
        description={t("settings.slackDescription")}
      >
        <SettingsRow
          label={
            slackStatus.isLoading
              ? t("settings.checkingSlack")
              : connected
                ? t("settings.slackConnected", {
                    count: installations.length,
                  })
                : oauthConfigured
                  ? t("common.notConnected")
                  : t("settings.slackOauthNeeded")
          }
          description={
            !oauthConfigured
              ? t("settings.slackClientMissing")
              : !signingConfigured
                ? t("settings.slackSigningMissing")
                : t("settings.slackPreviewDescription")
          }
          icon={<IconBrandSlack className="text-primary" />}
          control={
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleConnect}
              disabled={connecting || slackStatus.isLoading || !oauthConfigured}
            >
              {connecting ? <IconLoader2 className="animate-spin" /> : null}
              {t("settings.connectSlack")}
            </Button>
          }
        />

        {installations.map((installation) => (
          <SettingsRow
            key={installation.id}
            label={installation.teamName || installation.teamId}
            description={[
              installation.status,
              installation.enterpriseName,
              t("settings.connectedBy", { email: installation.ownerEmail }),
            ]
              .filter(Boolean)
              .join(" · ")}
            control={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("settings.disconnectSlackLabel", {
                  team: installation.teamName || installation.teamId,
                })}
                onClick={() => setDisconnectTarget(installation)}
              >
                <IconTrash />
              </Button>
            }
          />
        ))}
      </SettingsGroup>

      <AlertDialog
        open={!!disconnectTarget}
        onOpenChange={(open) => {
          if (!open && !disconnecting) setDisconnectTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.disconnectSlackTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.disconnectSlackDescription", {
                team:
                  disconnectTarget?.teamName ||
                  disconnectTarget?.teamId ||
                  t("settings.thisWorkspace"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDisconnect();
              }}
              disabled={disconnecting}
            >
              {disconnecting
                ? t("common.disconnecting")
                : t("common.disconnect")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
