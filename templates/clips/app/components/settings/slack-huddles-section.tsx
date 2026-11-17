// "Connect Slack for huddles" in Settings ›
// Channels › Slack. Each person connects their own Slack account; recorded
// huddles then list who was in them.
import {
  agentNativePath,
  appApiPath,
} from "@agent-native/core/client/api-path";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  SettingsGroup,
  SettingsLoadingRow,
  SettingsRow,
} from "@agent-native/toolkit/app/settings";
import { IconBrandSlack } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { PopupBlockedError } from "@/lib/popup-blocked";

import { LoadFailedRow } from "./load-failed-row";

interface SlackHuddleConnection {
  id: string;
  teamId: string;
  teamName: string | null;
  status: string;
}

interface SlackHuddleConnectionsResponse {
  oauthConfigured: boolean;
  connections: SlackHuddleConnection[];
}

async function waitForPopupClose(popup: Window): Promise<void> {
  await new Promise<void>((resolve) => {
    const started = Date.now();
    const interval = window.setInterval(() => {
      if (popup.closed || Date.now() - started > 5 * 60 * 1000) {
        window.clearInterval(interval);
        resolve();
      }
    }, 500);
  });
}

async function startSlackHuddlesOAuth(): Promise<void> {
  const res = await fetch(
    agentNativePath(
      "/_agent-native/actions/connect-slack-huddles?returnUrl=/settings",
    ),
  );
  // coercion-ok: a non-JSON body still fails below on `!res.ok` or the missing URL.
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    url?: string;
    result?: { url?: string };
  };
  if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
  const url = data.result?.url ?? data.url;
  if (!url) throw new Error("No Slack OAuth URL returned");
  const popup = window.open(
    new URL(appApiPath(url), window.location.origin).toString(),
    "clips-slack-huddles-oauth",
    "width=600,height=760",
  );
  if (!popup) throw new PopupBlockedError();
  await waitForPopupClose(popup);
}

async function disconnectSlackHuddles(id: string): Promise<void> {
  const res = await fetch(
    agentNativePath("/_agent-native/actions/disconnect-slack-huddles"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    },
  );
  if (!res.ok) {
    // coercion-ok: an error body may not be JSON; the status code still fails it.
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Disconnect failed (${res.status})`);
  }
}

export function SlackHuddlesSection() {
  const t = useT();
  const status = useActionQuery<SlackHuddleConnectionsResponse>(
    "list-slack-huddle-connections",
    undefined,
    { retry: false },
  );
  const [busy, setBusy] = useState(false);
  const connections = status.data?.connections ?? [];
  const oauthConfigured = status.data?.oauthConfigured ?? false;

  async function handleConnect() {
    setBusy(true);
    try {
      await startSlackHuddlesOAuth();
      const refreshed = await status.refetch();
      if ((refreshed.data?.connections?.length ?? 0) > connections.length) {
        toast.success(t("clipsSettings.huddlesConnectedToast"));
      }
    } catch (err) {
      toast.error(
        err instanceof PopupBlockedError
          ? t("clipsSettings.popupBlocked")
          : err instanceof Error
            ? err.message
            : t("clipsSettings.huddlesConnectFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect(id: string) {
    setBusy(true);
    try {
      await disconnectSlackHuddles(id);
      await status.refetch();
      toast.success(t("clipsSettings.huddlesDisconnectedToast"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("settings.slackDisconnectFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsGroup
      id="slack-huddles"
      title={t("clipsSettings.huddlesTitle")}
      description={t("clipsSettings.huddlesDescription")}
    >
      {status.isError ? (
        <LoadFailedRow onRetry={() => void status.refetch()} />
      ) : !status.data ? (
        <SettingsLoadingRow />
      ) : connections.length === 0 ? (
        <SettingsRow
          label={t("common.notConnected")}
          description={
            oauthConfigured ? undefined : t("settings.slackClientMissing")
          }
          icon={<IconBrandSlack />}
          control={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleConnect()}
              disabled={busy || !oauthConfigured}
            >
              {busy ? <Spinner /> : null}
              {t("clipsSettings.huddlesConnect")}
            </Button>
          }
        />
      ) : (
        connections.map((connection) => (
          <SettingsRow
            key={connection.id}
            label={connection.teamName || connection.teamId}
            description={
              connection.status === "connected"
                ? t("clipsSettings.huddlesConnected")
                : t("clipsSettings.huddlesNeedsReconnect")
            }
            icon={<IconBrandSlack />}
            control={
              connection.status === "connected" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleDisconnect(connection.id)}
                >
                  {t("common.disconnect")}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || !oauthConfigured}
                  onClick={() => void handleConnect()}
                >
                  {busy ? <Spinner /> : null}
                  {t("clipsSettings.huddlesConnect")}
                </Button>
              )
            }
          />
        ))
      )}
    </SettingsGroup>
  );
}
