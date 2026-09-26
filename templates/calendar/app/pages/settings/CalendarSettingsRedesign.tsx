import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  SettingsGroup,
  SettingsRow,
  type SettingsAppArea,
  type SettingsSearchEntry,
} from "@agent-native/core/client/settings";
import {
  AppearancePicker,
  type AppearancePresetId,
} from "@agent-native/core/client/ui";
import type { Settings } from "@shared/api";
import { isCalendarWeekStart } from "@shared/calendar-week";
import { IconBrandGoogle, IconBrandZoom } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { GoogleSetupWizard } from "@/components/calendar/GoogleSetupWizard";
import { TimezoneCombobox } from "@/components/TimezoneCombobox";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  getMeetingStartNotificationPermission,
  requestMeetingStartNotificationPermission,
} from "@/hooks/use-meeting-start-notifications";
import { useSettings, useUpdateSettings } from "@/hooks/use-settings";

import { CalendarEventRulesFields } from "./CalendarEventRules";
import { useCalendarConnections } from "./use-calendar-connections";

export const AVAILABILITY_SETTINGS_PATH = "/booking-links?tab=availability";
const BOOKING_LINKS_PATH = "/booking-links";
const MIN_EVENT_DURATION = 5;
const MAX_EVENT_DURATION = 480;
const SETTINGS_QUERY_KEY = ["action", "get-settings"] as const;

/** The browser's permission for meeting-start notifications; null when unsupported. */
export function useDesktopNotificationPermission() {
  const t = useT();
  const [permission, setPermission] = useState<NotificationPermission | null>(
    () => getMeetingStartNotificationPermission(),
  );
  const [pending, setPending] = useState(false);
  const request = useCallback(async () => {
    setPending(true);
    try {
      const next = await requestMeetingStartNotificationPermission();
      setPermission(next);
      if (next !== "granted") {
        toast.error(t("settings.desktopNotificationsBlocked"));
      }
    } catch {
      toast.error(t("settings.desktopNotificationsBlocked"));
    } finally {
      setPending(false);
    }
  }, [t]);
  return { permission, pending, request };
}

/**
 * Saves one or more calendar settings at once, showing the change before the
 * server answers and restoring the previous values if the save fails.
 */
function useSaveCalendarSettings() {
  const t = useT();
  const queryClient = useQueryClient();
  const updateSettings = useUpdateSettings();
  const mutate = updateSettings.mutate;
  return useCallback(
    (patch: Partial<Settings>) => {
      const previous = queryClient.getQueriesData<Settings>({
        queryKey: SETTINGS_QUERY_KEY,
      });
      queryClient.setQueriesData<Settings>(
        { queryKey: SETTINGS_QUERY_KEY },
        (current) => (current ? { ...current, ...patch } : current),
      );
      mutate(patch, {
        onError: () => {
          for (const [key, value] of previous) {
            queryClient.setQueryData(key, value);
          }
          toast.error(t("settings.saveFailed"));
        },
      });
    },
    [mutate, queryClient, t],
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6"
        >
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </>
  );
}

function SettingsLoadFailedRow({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <SettingsRow
      label={t("common.loadFailed")}
      control={
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      }
    />
  );
}

function DefaultDurationInput({
  value,
  onSave,
}: {
  value: number;
  onSave: (minutes: number) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  function commit() {
    const minutes = Number(draft);
    if (minutes === value) return;
    if (
      !Number.isInteger(minutes) ||
      minutes < MIN_EVENT_DURATION ||
      minutes > MAX_EVENT_DURATION
    ) {
      setDraft(String(value));
      toast.error(t("calendarSettings.durationInvalid"));
      return;
    }
    onSave(minutes);
  }

  return (
    <Input
      id="default-duration-input"
      type="number"
      inputMode="numeric"
      min={MIN_EVENT_DURATION}
      max={MAX_EVENT_DURATION}
      value={draft}
      aria-label={t("calendarSettings.defaultDuration")}
      className="w-24"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

/** Calendar's own groups on its General page, below core's Agent group. */
export function CalendarGeneralGroups() {
  const t = useT();
  const settingsQuery = useSettings();
  const settings = settingsQuery.data;
  const save = useSaveCalendarSettings();
  const weekStartLabel = t("settings.weekStartLabel");
  const colorThemeLabel = t("calendarSettings.colorTheme");

  return (
    <>
      <SettingsGroup id="events" title={t("calendarSettings.eventsGroup")}>
        {settings ? (
          <>
            {/* Calendar keeps its own zone, apart from Account › Preferences:
                peers' overlays and the public booking page read it. */}
            <SettingsRow
              id="timezone"
              label={t("calendarSettings.timezone")}
              description={t("calendarSettings.timezoneDescription")}
              control={
                <div className="w-full sm:w-64">
                  <TimezoneCombobox
                    id="calendar-timezone"
                    value={settings.timezone}
                    onChange={(timezone) => {
                      if (timezone !== settings.timezone) save({ timezone });
                    }}
                  />
                </div>
              }
            />
            <SettingsRow
              id="week-start"
              label={weekStartLabel}
              control={
                <Select
                  value={
                    isCalendarWeekStart(settings.weekStart)
                      ? settings.weekStart
                      : "sunday"
                  }
                  onValueChange={(weekStart) => {
                    if (isCalendarWeekStart(weekStart)) save({ weekStart });
                  }}
                >
                  <SelectTrigger
                    className="w-full sm:w-56"
                    aria-label={weekStartLabel}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sunday">
                      {t("settings.weekStartSunday")}
                    </SelectItem>
                    <SelectItem value="monday">
                      {t("settings.weekStartMonday")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              }
            />
            <SettingsRow
              id="default-duration"
              label={t("calendarSettings.defaultDuration")}
              description={t("calendarSettings.defaultDurationDescription")}
              control={
                <DefaultDurationInput
                  value={settings.defaultEventDuration}
                  onSave={(defaultEventDuration) =>
                    save({ defaultEventDuration })
                  }
                />
              }
            />
          </>
        ) : settingsQuery.isError ? (
          <SettingsLoadFailedRow onRetry={() => void settingsQuery.refetch()} />
        ) : (
          <SkeletonRows count={3} />
        )}
      </SettingsGroup>
      <SettingsGroup
        id="appearance-group"
        title={t("calendarSettings.appearanceGroup")}
      >
        <SettingsRow
          id="appearance"
          label={colorThemeLabel}
          description={t("settings.appearanceDescription")}
          control={
            <AppearancePicker
              onChange={(preset: AppearancePresetId) => {
                // The picker applies the preset locally first; the action
                // keeps it across reloads and devices.
                callAction("change-appearance" as any, { preset } as any).catch(
                  () => toast.error(t("settings.saveFailed")),
                );
              }}
            />
          }
        />
      </SettingsGroup>
    </>
  );
}

function GoogleSetupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("settings.connectGoogleCalendar")}</DialogTitle>
        </DialogHeader>
        <GoogleSetupWizard />
      </DialogContent>
    </Dialog>
  );
}

function DisconnectConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  // guard:allow-required-description - a disconnect confirm must say what stops working
  description: string;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("calendarSettings.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {t("common.disconnect")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function connectedAs(accounts: readonly string[]): string | null {
  const names = accounts.filter(Boolean);
  return names.length > 0 ? names.join(", ") : null;
}

/** Calendars tab: the Google Calendar and Zoom connections. */
export function CalendarConnectionsArea() {
  const t = useT();
  const connections = useCalendarConnections();
  const { googleStatus, zoomStatus } = connections;
  const [setupOpen, setSetupOpen] = useState(false);
  const [confirming, setConfirming] = useState<"google" | "zoom" | null>(null);

  const googleAccounts = connectedAs(
    googleStatus.data?.accounts?.map((account) => account.email) ?? [],
  );
  const zoomAccounts = connectedAs(
    zoomStatus.data?.accounts?.map(
      (account) => account.email || account.displayName || account.id,
    ) ?? [],
  );

  const googleRow = googleStatus.isLoading ? (
    <SkeletonRows count={1} />
  ) : connections.showGoogle ? (
    <SettingsRow
      id="google-calendar"
      icon={<IconBrandGoogle />}
      label={t("settings.googleCalendar")}
      description={
        googleStatus.isError
          ? t("common.loadFailed")
          : googleStatus.data?.connected && googleAccounts
            ? t("calendarSettings.connectedAs", { accounts: googleAccounts })
            : t("settings.googleDescription")
      }
      control={
        googleStatus.isError ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void googleStatus.refetch()}
            disabled={googleStatus.isFetching}
          >
            {t("common.retry")}
          </Button>
        ) : connections.canDisconnectGoogle ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirming("google")}
            disabled={connections.isGoogleDisconnectPending}
          >
            {t("common.disconnect")}
          </Button>
        ) : googleStatus.data?.connected ? null : googleStatus.data
            ?.configured === true ? (
          <Button
            size="sm"
            onClick={connections.connectGoogle}
            disabled={connections.isGoogleDesktopAuthPending}
          >
            {t("common.connect")}
          </Button>
        ) : connections.canOfferGoogleOAuthSetup ? (
          <Button size="sm" onClick={() => setSetupOpen(true)}>
            {t("calendarSettings.setUp")}
          </Button>
        ) : null
      }
    />
  ) : null;

  const zoomRow = zoomStatus.isLoading ? (
    <SkeletonRows count={1} />
  ) : (
    <SettingsRow
      id="zoom"
      icon={<IconBrandZoom />}
      label={t("calendarSettings.zoom")}
      description={
        zoomStatus.isError
          ? t("common.loadFailed")
          : zoomStatus.data?.connected && zoomAccounts
            ? t("calendarSettings.connectedAs", { accounts: zoomAccounts })
            : zoomStatus.data?.configured === false
              ? t("settings.zoomCredentialsPrompt")
              : t("settings.zoomDescription")
      }
      control={
        zoomStatus.isError ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void zoomStatus.refetch()}
            disabled={zoomStatus.isFetching}
          >
            {t("common.retry")}
          </Button>
        ) : zoomStatus.data?.connected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirming("zoom")}
            disabled={connections.isZoomDisconnectPending}
          >
            {t("common.disconnect")}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={connections.connectZoomAccount}
            disabled={
              connections.isZoomConnectPending ||
              zoomStatus.data?.configured === false
            }
          >
            {t("common.connect")}
          </Button>
        )
      }
    />
  );

  return (
    <>
      <SettingsGroup id="calendar-connections">
        {googleRow}
        {zoomRow}
      </SettingsGroup>
      <GoogleSetupDialog open={setupOpen} onOpenChange={setSetupOpen} />
      <DisconnectConfirmDialog
        open={confirming === "google"}
        onOpenChange={(open) => setConfirming(open ? "google" : null)}
        title={t("calendarSettings.disconnectGoogleTitle")}
        description={t("calendarSettings.disconnectGoogleDescription")}
        onConfirm={() => void connections.disconnectGoogleAccounts()}
      />
      <DisconnectConfirmDialog
        open={confirming === "zoom"}
        onOpenChange={(open) => setConfirming(open ? "zoom" : null)}
        title={t("calendarSettings.disconnectZoomTitle")}
        description={t("calendarSettings.disconnectZoomDescription")}
        onConfirm={connections.disconnectZoomAccount}
      />
    </>
  );
}

function FallbackBookingPageDialog({
  open,
  onOpenChange,
  settings,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onSave: (patch: Partial<Settings>) => void;
}) {
  const t = useT();
  const [title, setTitle] = useState(settings.bookingPageTitle);
  const [description, setDescription] = useState(
    settings.bookingPageDescription,
  );
  useEffect(() => {
    if (!open) return;
    setTitle(settings.bookingPageTitle);
    setDescription(settings.bookingPageDescription);
  }, [open, settings.bookingPageDescription, settings.bookingPageTitle]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("calendarSettings.fallbackBookingPage")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({
              bookingPageTitle: title,
              bookingPageDescription: description,
            });
            onOpenChange(false);
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="fallback-booking-title">
              {t("calendarSettings.fallbackTitle")}
            </Label>
            <Input
              id="fallback-booking-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("settings.bookingTitlePlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="fallback-booking-description">
              {t("calendarSettings.fallbackDescription")}
            </Label>
            <Textarea
              id="fallback-booking-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("settings.bookingDescriptionPlaceholder")}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {t("calendarSettings.cancel")}
            </Button>
            <Button type="submit">{t("calendarSettings.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Booking tab: availability, the fallback booking page copy, and booking links. */
export function CalendarBookingArea() {
  const t = useT();
  const settingsQuery = useSettings();
  const settings = settingsQuery.data;
  const save = useSaveCalendarSettings();
  const [editOpen, setEditOpen] = useState(false);
  const manage = t("calendarSettings.manage");

  return (
    <SettingsGroup id="booking">
      <SettingsRow
        id="availability"
        label={t("bookingLinks.availability")}
        description={t("bookingLinks.availabilityDescription")}
        control={
          <Button variant="outline" size="sm" asChild>
            <Link to={AVAILABILITY_SETTINGS_PATH}>{manage}</Link>
          </Button>
        }
      />
      {settings ? (
        <SettingsRow
          id="booking-page"
          label={t("calendarSettings.fallbackBookingPage")}
          description={t("calendarSettings.fallbackBookingPageDescription")}
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
            >
              {t("calendarSettings.edit")}
            </Button>
          }
        />
      ) : settingsQuery.isError ? (
        <SettingsLoadFailedRow onRetry={() => void settingsQuery.refetch()} />
      ) : (
        <SkeletonRows count={1} />
      )}
      <SettingsRow
        id="booking-links"
        label={t("navigation.bookingLinks")}
        description={t("calendarSettings.bookingLinksDescription")}
        control={
          <Button variant="outline" size="sm" asChild>
            <Link to={BOOKING_LINKS_PATH}>{manage}</Link>
          </Button>
        }
      />
      {settings ? (
        <FallbackBookingPageDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          settings={settings}
          onSave={save}
        />
      ) : null}
    </SettingsGroup>
  );
}

/** Rules tab: the Jev invitation rules and their recent activity. */
export function CalendarEventRulesArea() {
  return (
    <SettingsGroup id="event-rules">
      <div className="space-y-4 px-5 py-4 sm:px-6">
        <CalendarEventRulesFields />
      </div>
    </SettingsGroup>
  );
}

/** Notifications page: meeting-start desktop notifications for this browser. */
export function CalendarNotificationsGroups({
  permission,
  pending,
  onEnable,
}: {
  permission: NotificationPermission;
  pending: boolean;
  onEnable: () => void;
}) {
  const t = useT();
  return (
    <SettingsGroup id="desktop">
      <SettingsRow
        id="desktop-notifications"
        label={t("settings.desktopNotifications")}
        description={t("settings.desktopNotificationsDescription")}
        control={
          permission === "granted" ? (
            <span className="text-sm text-muted-foreground">
              {t("settings.desktopNotificationsEnabled")}
            </span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={onEnable}
              disabled={pending}
            >
              {t("settings.enableDesktopNotifications")}
            </Button>
          )
        }
      />
    </SettingsGroup>
  );
}

/** The props Calendar passes the redesigned Settings shell. */
export function useCalendarSettingsRedesign(
  notificationPermission: ReturnType<typeof useDesktopNotificationPermission>,
) {
  const t = useT();
  const { permission, pending, request } = notificationPermission;

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "calendar-timezone",
        label: t("calendarSettings.timezone"),
        keywords: "calendar timezone time zone region events",
        hash: "timezone",
      },
      {
        id: "calendar-week-start",
        label: t("settings.weekStartLabel"),
        keywords: "week start sunday monday first day",
        hash: "week-start",
      },
      {
        id: "calendar-default-duration",
        label: t("calendarSettings.defaultDuration"),
        keywords: "default event duration length minutes",
        hash: "default-duration",
      },
      {
        id: "calendar-appearance",
        label: t("calendarSettings.colorTheme"),
        keywords: "appearance theme color",
        hash: "appearance",
      },
    ],
    [t],
  );

  const appAreas = useMemo<SettingsAppArea[]>(
    () => [
      {
        id: "calendars",
        label: t("calendarSettings.calendarsTab"),
        keywords: "calendars google zoom connect accounts",
        content: <CalendarConnectionsArea />,
        searchEntries: [
          {
            id: "calendar-google",
            label: t("settings.googleCalendar"),
            keywords: "google calendar connect oauth sync account",
            hash: "google-calendar",
          },
          {
            id: "calendar-zoom",
            label: t("calendarSettings.zoom"),
            keywords: "zoom meeting video conferencing connect",
            hash: "zoom",
          },
        ],
      },
      {
        id: "booking",
        label: t("calendarSettings.bookingTab"),
        keywords: "booking availability booking links booking page",
        content: <CalendarBookingArea />,
        searchEntries: [
          {
            id: "calendar-availability",
            label: t("bookingLinks.availability"),
            keywords:
              "availability available hours booking schedule working hours",
            hash: "availability",
          },
          {
            id: "calendar-booking-page",
            label: t("calendarSettings.fallbackBookingPage"),
            keywords: "booking page title description fallback",
            hash: "booking-page",
          },
          {
            id: "calendar-booking-links",
            label: t("navigation.bookingLinks"),
            keywords: "booking links public url share",
            hash: "booking-links",
          },
        ],
      },
      {
        id: "rules",
        label: t("settings.eventRules"),
        keywords: "jev invitation rules accept decline hide",
        content: <CalendarEventRulesArea />,
        searchEntries: [
          {
            id: "calendar-event-rules",
            label: t("settings.eventRules"),
            keywords: "jev invitation rules accept decline hide",
            hash: "event-rules",
          },
        ],
      },
    ],
    [t],
  );

  const notificationsSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "calendar-desktop-notifications",
        label: t("settings.desktopNotifications"),
        keywords: "desktop system notifications meeting reminders permission",
        hash: "desktop-notifications",
      },
    ],
    [t],
  );

  return {
    generalGroups: <CalendarGeneralGroups />,
    generalSearchEntries,
    appAreas,
    // Browsers without the Notification API have nothing to show, so the
    // Notifications page stays hidden there.
    notifications:
      permission === null ? undefined : (
        <CalendarNotificationsGroups
          permission={permission}
          pending={pending}
          onEnable={() => void request()}
        />
      ),
    notificationsSearchEntries:
      permission === null ? undefined : notificationsSearchEntries,
  };
}
