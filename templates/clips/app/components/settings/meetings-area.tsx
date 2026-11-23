import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  SettingsGroup,
  SettingsLoadingRow,
  SettingsRow,
} from "@agent-native/toolkit/app/settings";
import {
  IconArrowUpRight,
  IconBrandGoogle,
  IconCalendar,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useState, type CSSProperties } from "react";
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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useCalendarConnect } from "@/hooks/use-calendar-connect";
import { attemptOpenDesktopApp } from "@/lib/capture-install-options";

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

interface CalendarChoice {
  id: string;
  name: string;
  color: string | null;
  primary: boolean;
  enabled: boolean;
}

interface AccountCalendars {
  accountId: string;
  canChange: boolean;
  calendars: CalendarChoice[];
  error?: string;
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
      queryKey: ["action", "list-calendars"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["action", "list-meetings"],
    });
  };
}

function CalendarSwitchItem({
  accountId,
  calendar,
  canChange,
}: {
  accountId: string;
  calendar: CalendarChoice;
  canChange: boolean;
}) {
  const t = useT();
  const invalidate = useInvalidateCalendar();
  const setEnabled = useActionMutation<
    unknown,
    { accountId: string; calendarId: string; enabled: boolean }
  >("set-calendar-enabled");
  const [flipped, setFlipped] = useState<boolean | null>(null);
  if (flipped !== null && flipped === calendar.enabled) setFlipped(null);
  const checked = flipped ?? calendar.enabled;

  function toggle(enabled: boolean) {
    if (setEnabled.isPending) return;
    setFlipped(enabled);
    setEnabled.mutate(
      { accountId, calendarId: calendar.id, enabled },
      {
        onSuccess: () => invalidate(),
        onError: (error) => {
          setFlipped(null);
          toast.error(error.message || t("settings.saveFailed"));
        },
      },
    );
  }

  return (
    <Item size="sm" className="rounded-none">
      <ItemMedia>
        <span
          aria-hidden="true"
          className="size-2.5 rounded-full bg-(--swatch,var(--color-muted-foreground))"
          style={{ "--swatch": calendar.color } as CSSProperties}
        />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="min-w-0 max-w-full">
          <span className="truncate">{calendar.name}</span>
        </ItemTitle>
        {calendar.primary ? (
          <ItemDescription>{t("clipsSettings.mainCalendar")}</ItemDescription>
        ) : null}
      </ItemContent>
      <ItemActions>
        <Switch
          aria-label={t("clipsSettings.showCalendar", {
            calendar: calendar.name,
          })}
          checked={checked}
          onCheckedChange={toggle}
          disabled={!canChange}
        />
      </ItemActions>
    </Item>
  );
}

function AccountCalendarList({ accountId }: { accountId: string }) {
  const t = useT();
  const query = useActionQuery<{ accounts: AccountCalendars[] }>(
    "list-calendars",
    { accountId },
    { retry: false },
  );
  const account = query.data?.accounts.find(
    (entry) => entry.accountId === accountId,
  );

  if (query.isError || account?.error) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t("clipsSettings.calendarsLoadFailed")}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
        >
          {t("libraryGrid.retry")}
        </Button>
      </div>
    );
  }
  if (!query.data) {
    return <Skeleton className="h-11 w-full" />;
  }
  if (!account || account.calendars.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {t("clipsSettings.calendarsDescription")}
      </p>
      <ItemGroup className="overflow-hidden rounded-lg border border-border">
        {account.calendars.map((calendar, index) => (
          <Fragment key={calendar.id}>
            {index > 0 ? <ItemSeparator /> : null}
            <CalendarSwitchItem
              accountId={accountId}
              calendar={calendar}
              canChange={account.canChange}
            />
          </Fragment>
        ))}
      </ItemGroup>
    </div>
  );
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
  const [target, setTarget] = useState<CalendarAccount | null>(null);

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

  const allAccounts = accounts.data?.accounts ?? [];
  const { connect, isConnecting: connecting } = useCalendarConnect(allAccounts);
  const googleAccounts = allAccounts.filter(
    (account) => account.provider === "google",
  );
  const connectButton = (label: string, expectedAccountId?: string) => (
    <Button
      type="button"
      variant="outline"
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
                      variant="outline"
                      size="sm"
                      onClick={() => setTarget(account)}
                    >
                      {t("common.disconnect")}
                    </Button>
                  )
                }
              >
                {account.status === "connected" ? (
                  <AccountCalendarList accountId={account.id} />
                ) : null}
              </SettingsRow>
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
              variant="outline"
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
