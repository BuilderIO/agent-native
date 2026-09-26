import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  SettingsGroup,
  SettingsLoadingRow,
  SettingsRow,
} from "@agent-native/core/client/settings";
import {
  IconArrowUpRight,
  IconBrandGoogle,
  IconCalendar,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { startCalendarOAuth } from "@/lib/calendar-oauth";
import { attemptOpenDesktopApp } from "@/lib/capture-install-options";
import { PopupBlockedError } from "@/lib/popup-blocked";

import { FeatureKeysGroup } from "./feature-keys-group";
import { LoadFailedRow } from "./load-failed-row";

export const CALENDAR_APP_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

interface CalendarAccount {
  id: string;
  provider: string;
  displayName?: string | null;
  email?: string | null;
  status?: string | null;
}

function accountName(account: CalendarAccount): string {
  return account.email || account.displayName || account.id;
}

function useInvalidateCalendar() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({
      queryKey: ["action", "list-calendar-accounts"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["action", "list-meetings"],
    });
  };
}

function CalendarGroup() {
  const t = useT();
  const accounts = useActionQuery<{ accounts: CalendarAccount[] }>(
    "list-calendar-accounts",
    {},
    { retry: false },
  );
  const invalidate = useInvalidateCalendar();
  const disconnect = useActionMutation<unknown, { id: string }>(
    "disconnect-calendar",
  );
  const [connecting, setConnecting] = useState(false);
  const connectingRef = useRef(false);
  const [target, setTarget] = useState<CalendarAccount | null>(null);

  function connect(expectedAccountId?: string) {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setConnecting(true);
    void startCalendarOAuth(expectedAccountId)
      .then((result) => {
        if (!result) return;
        invalidate();
        toast.success(t("meetingsRoute.calendarConnected"));
      })
      .catch((err: Error) =>
        toast.error(
          err instanceof PopupBlockedError
            ? t("clipsSettings.popupBlocked")
            : err.message,
        ),
      )
      .finally(() => {
        connectingRef.current = false;
        setConnecting(false);
      });
  }

  function confirmDisconnect() {
    if (!target) return;
    disconnect.mutate(
      { id: target.id },
      {
        onSuccess: () => {
          setTarget(null);
          invalidate();
          toast.success(t("meetingsRoute.calendarDisconnected"));
        },
        onError: (error) =>
          toast.error(error.message || t("clipsSettings.disconnectFailed")),
      },
    );
  }

  const googleAccounts = (accounts.data?.accounts ?? []).filter(
    (account) => account.provider === "google",
  );
  const connectButton = (label: string, expectedAccountId?: string) => (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={connecting}
      onClick={() => connect(expectedAccountId)}
    >
      {connecting ? <Spinner /> : null}
      {label}
    </Button>
  );

  return (
    <>
      <SettingsGroup id="calendar" title={t("clipsSettings.calendarGroup")}>
        {accounts.isError ? (
          <LoadFailedRow onRetry={() => void accounts.refetch()} />
        ) : !accounts.data ? (
          <SettingsLoadingRow />
        ) : googleAccounts.length === 0 ? (
          <Empty id="google-calendar" className="scroll-mt-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconCalendar />
              </EmptyMedia>
              <EmptyTitle>{t("meetingsRoute.guideCalendarTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("meetingsRoute.guideCalendarDescription")}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {connectButton(t("clipsSettings.connect"))}
            </EmptyContent>
          </Empty>
        ) : (
          <>
            {googleAccounts.map((account, index) => (
              <SettingsRow
                key={account.id}
                id={index === 0 ? "google-calendar" : `calendar-${account.id}`}
                icon={<IconBrandGoogle />}
                label={t("clipsSettings.googleCalendar")}
                description={
                  account.status === "needs-reauth"
                    ? t("clipsSettings.needsReconnect", {
                        account: accountName(account),
                      })
                    : t("clipsSettings.connectedAs", {
                        account: accountName(account),
                      })
                }
                control={
                  account.status === "needs-reauth" ? (
                    connectButton(t("clipsSettings.reconnect"), account.id)
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setTarget(account)}
                    >
                      {t("common.disconnect")}
                    </Button>
                  )
                }
              />
            ))}
            <SettingsRow
              id="add-calendar"
              label={t("meetingsRoute.addAnotherCalendarAccount")}
              control={connectButton(t("clipsSettings.connect"))}
            />
          </>
        )}
      </SettingsGroup>

      <AlertDialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open && !disconnect.isPending) setTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("meetingsRoute.disconnectGoogleCalendarTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("clipsSettings.disconnectCalendarDescription", {
                account: target ? accountName(target) : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={disconnect.isPending}
              onClick={() => setTarget(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={disconnect.isPending}
              onClick={confirmDisconnect}
            >
              {disconnect.isPending ? <Spinner /> : null}
              {disconnect.isPending
                ? t("common.disconnecting")
                : t("common.disconnect")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Clips › General › Meetings, while the Meetings lab is on. */
export function ClipsMeetingsArea({ canManage }: { canManage: boolean }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-8">
      <CalendarGroup />
      {canManage ? (
        <FeatureKeysGroup
          id="calendar-app"
          title={t("clipsSettings.calendarApp")}
          keys={CALENDAR_APP_KEYS}
        />
      ) : null}
      <SettingsGroup id="desktop" title={t("clipsSettings.desktopGroup")}>
        <SettingsRow
          id="meeting-capture"
          label={t("clipsSettings.meetingCapture")}
          description={t("clipsSettings.meetingCaptureDescription")}
          control={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => attemptOpenDesktopApp()}
            >
              {t("clipsSettings.openClipsDesktop")}
              <IconArrowUpRight aria-hidden="true" />
            </Button>
          }
        />
      </SettingsGroup>
    </div>
  );
}
