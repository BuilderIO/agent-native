import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import {
  callAction,
  useActionMutation,
  useActionQuery,
  actionErrorMessage,
} from "@agent-native/core/client/hooks";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import { startWorkspaceProviderOAuth } from "@agent-native/core/client/integrations";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import { TeamPage } from "@agent-native/core/client/org";
import {
  AccountSettingsCard,
  BuilderConnectPopover,
  SettingsGroup,
  SettingsRow,
  SettingsTabsPage,
  useBuilderConnectFlow,
  useAgentSettingsTabs,
  type SettingsSearchEntry,
} from "@agent-native/core/client/settings";
import {
  AppearancePicker,
  type AppearancePresetId,
} from "@agent-native/core/client/ui";
import type { CalendarWeekStart } from "@shared/calendar-week";
import { isCalendarWeekStart } from "@shared/calendar-week";
import {
  IconBrandZoom,
  IconExternalLink,
  IconLink,
  IconUnlink,
  IconCircleCheck,
  IconCircleX,
  IconInfoCircle,
} from "@tabler/icons-react";
import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { GoogleSetupWizard } from "@/components/calendar/GoogleSetupWizard";
import { TimezoneCombobox } from "@/components/TimezoneCombobox";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useGoogleAuthStatus,
  useGoogleDesktopAuth,
  useDisconnectGoogle,
} from "@/hooks/use-google-auth";
import {
  getMeetingStartNotificationPermission,
  requestMeetingStartNotificationPermission,
} from "@/hooks/use-meeting-start-notifications";
import { useSettings, useUpdateSettings } from "@/hooks/use-settings";
import {
  useConnectZoom,
  useDisconnectZoom,
  useZoomStatus,
} from "@/hooks/use-zoom-auth";
import { shouldOfferGoogleOAuthSetup } from "@/lib/google-oauth-setup";

import changelog from "../../CHANGELOG.md?raw";

const AVAILABILITY_SETTINGS_PATH = "/booking-links?tab=availability";

export default function Settings() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const eventRulesStatus = useActionQuery<{
    jevConfigured: boolean;
    enabled: boolean;
    intervalMinutes: number | null;
    message: string | null;
    lastError: string | null;
    accountRefreshErrors: Array<{ email: string; error: string }>;
    conflictsSkipped: boolean;
    reason: string | null;
    registered: boolean;
  }>("get-event-rules-status", undefined, {
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const jevConnectFlow = useBuilderConnectFlow({
    trackingSource: "calendar_jev_invitation_rules",
    trackingFlow: "connect_jev",
    onConnected: () => void eventRulesStatus.refetch(),
  });
  const undoEventRuleActivity = useActionMutation<
    { success: boolean; activityId: string },
    { activityId: string }
  >("undo-calendar-event-rule", {
    onSuccess: () => toast.success(t("settings.eventRuleUndoDone")),
    onError: (error) => {
      const code = (error as { errorCode?: unknown } | null)?.errorCode;
      const message =
        code === "conflict" ? undefined : actionErrorMessage(error);
      toast.error(message ?? t("settings.eventRuleUndoFailed"));
    },
  });
  const googleStatus = useGoogleAuthStatus();
  const disconnectGoogle = useDisconnectGoogle();
  const {
    isDesktopGoogleAuth,
    isGoogleDesktopAuthPending,
    startDesktopGoogleAuth,
  } = useGoogleDesktopAuth({
    onError: (issue) =>
      toast.error(issue.message || issue.error || t("settings.googleFailed")),
    onSuccess: () => window.location.reload(),
  });
  const zoomStatus = useZoomStatus();
  const connectZoom = useConnectZoom();
  const disconnectZoom = useDisconnectZoom();
  const canOfferGoogleOAuthSetup = shouldOfferGoogleOAuthSetup();

  const [timezone, setTimezone] = useState("");
  const [bookingTitle, setBookingTitle] = useState("");
  const [bookingDescription, setBookingDescription] = useState("");
  const [defaultDuration, setDefaultDuration] = useState(30);
  const [weekStart, setWeekStart] = useState<CalendarWeekStart>("sunday");
  const [eventRules, setEventRules] = useState({
    accept: "",
    decline: "",
    hide: "",
  });
  const eventRuleLabels = {
    accept: t("settings.eventRuleAccept"),
    decline: t("settings.eventRuleDecline"),
    hide: t("settings.eventRuleHide"),
  };
  const eventRulePlaceholders = {
    accept: t("settings.eventRulePlaceholderAccept"),
    decline: t("settings.eventRulePlaceholderDecline"),
    hide: t("settings.eventRulePlaceholderHide"),
  };
  const eventRuleActivityLabels = {
    accepted: t("settings.eventRuleActivityAccepted"),
    declined: t("settings.eventRuleActivityDeclined"),
    hidden: t("settings.eventRuleActivityHidden"),
  };
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission | null>(() =>
      getMeetingStartNotificationPermission(),
    );
  const [notificationPermissionPending, setNotificationPermissionPending] =
    useState(false);

  useEffect(() => {
    if (settings) {
      setTimezone(settings.timezone);
      setBookingTitle(settings.bookingPageTitle);
      setBookingDescription(settings.bookingPageDescription);
      setDefaultDuration(settings.defaultEventDuration);
      setWeekStart(
        isCalendarWeekStart(settings.weekStart) ? settings.weekStart : "sunday",
      );
      const nextEventRules = {
        accept: settings.eventRules?.accept ?? "",
        decline: settings.eventRules?.decline ?? "",
        hide: settings.eventRules?.hide ?? "",
      };
      setEventRules((current) =>
        current.accept === nextEventRules.accept &&
        current.decline === nextEventRules.decline &&
        current.hide === nextEventRules.hide
          ? current
          : nextEventRules,
      );
    }
  }, [settings]);

  function handleSave() {
    updateSettings.mutate(
      {
        timezone,
        bookingPageTitle: bookingTitle,
        bookingPageDescription: bookingDescription,
        defaultEventDuration: defaultDuration,
        weekStart,
      },
      {
        onSuccess: () => toast.success(t("settings.saved")),
        onError: () => toast.error(t("settings.saveFailed")),
      },
    );
  }

  function handleSaveRules() {
    updateSettings.mutate(
      { eventRules },
      {
        onSuccess: () => toast.success(t("settings.saved")),
        onError: () => toast.error(t("settings.saveFailed")),
      },
    );
  }

  function handleConnect() {
    if (isDesktopGoogleAuth) {
      startDesktopGoogleAuth({
        previousAccountCount: googleStatus.data?.accounts?.length ?? 0,
      });
      return;
    }
    const returnPath = `${window.location.pathname}${window.location.search}`;
    startWorkspaceProviderOAuth("google_calendar", {
      appId: "calendar",
      returnPath,
      scope: "user",
    });
  }

  async function handleDisconnect() {
    const accounts = (googleStatus.data?.accounts ?? []).filter(
      (account) => !account.shared,
    );
    if (accounts.length === 0) return;
    try {
      for (const account of accounts) {
        await disconnectGoogle.mutateAsync(account.email);
      }
      toast.success(t("settings.googleDisconnected"));
    } catch {
      toast.error(t("settings.disconnectFailed"));
    }
  }

  function handleConnectZoom() {
    connectZoom.mutate(undefined, {
      onSuccess: () => toast(t("settings.zoomOpened")),
      onError: (error) =>
        toast.error(
          error instanceof Error
            ? error.message
            : t("settings.zoomConnectFailed"),
        ),
    });
  }

  async function handleEnableDesktopNotifications() {
    setNotificationPermissionPending(true);
    try {
      const permission = await requestMeetingStartNotificationPermission();
      setNotificationPermission(permission);
      if (permission !== "granted") {
        toast.error(t("settings.desktopNotificationsBlocked"));
      }
    } catch {
      toast.error(t("settings.desktopNotificationsBlocked"));
    } finally {
      setNotificationPermissionPending(false);
    }
  }

  function handleDisconnectZoom() {
    disconnectZoom.mutate(undefined, {
      onSuccess: () => toast.success(t("settings.zoomDisconnected")),
      onError: () => toast.error(t("settings.zoomDisconnectFailed")),
    });
  }

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "calendar-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
      {
        id: "calendar-google",
        label: t("settings.googleCalendar"),
        keywords: "google calendar connect oauth sync account",
        hash: "google-calendar",
      },
      {
        id: "calendar-zoom",
        label: "Zoom",
        keywords: "zoom meeting video conferencing connect",
        hash: "zoom",
      },
      {
        id: "calendar-general",
        label: t("settings.general"),
        keywords:
          "timezone week start sunday monday booking duration defaults general",
        hash: "general-settings",
      },
      {
        id: "calendar-availability",
        label: t("bookingLinks.availability"),
        keywords: "availability available hours booking schedule working hours",
        hash: "availability",
      },
      {
        id: "calendar-appearance",
        label: t("settings.appearance"),
        keywords: "appearance theme color mode dark light",
        hash: "appearance",
      },
      {
        id: "calendar-notifications",
        label: t("settings.desktopNotifications"),
        keywords: "desktop system notifications meeting reminders permission",
        hash: "notifications",
      },
    ],
    [t],
  );
  const hasEventRules = Object.values(eventRules).some((rule) => rule.trim());
  const statusData = eventRulesStatus.data;
  const jevConfigured = statusData?.jevConfigured === true;
  const canEditEventRules =
    !eventRulesStatus.isLoading && !eventRulesStatus.isError && jevConfigured;
  const unavailableRulesMessage =
    statusData?.enabled === false && hasEventRules
      ? t(
          !statusData.registered
            ? "settings.eventRulesUnregistered"
            : statusData.reason === "disabled-by-env"
              ? "settings.eventRulesDeploymentDisabled"
              : "settings.eventRulesDisabled",
        )
      : null;
  const eventRulesStatusError = eventRulesStatus.isError
    ? t("common.loadFailed")
    : (statusData?.lastError ??
      (statusData?.conflictsSkipped
        ? t("settings.eventRulesConflict")
        : unavailableRulesMessage));
  const settingsTabs = [
    ...agentSettingsTabs,
    {
      id: "event-rules",
      label: t("settings.eventRules"),
      keywords: "jev invitation rules accept decline hide",
      content: (
        <Card
          id="event-rules"
          className="mx-auto w-full max-w-2xl scroll-mt-16"
        >
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">
                {t("settings.eventRules")}
              </CardTitle>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                      aria-label={t("settings.eventRulesHelpLabel")}
                    >
                      <IconInfoCircle className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">
                    {t("settings.eventRulesHelp")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="rules">
              <TabsList
                aria-label={t("settings.eventRules")}
                className="grid w-full grid-cols-2"
              >
                <TabsTrigger value="rules">
                  {t("settings.eventRulesTabRules")}
                </TabsTrigger>
                <TabsTrigger value="activity">
                  {t("settings.eventRulesRecentActivity")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="rules" className="space-y-4 pt-4">
                {eventRulesStatus.isError ? (
                  <div
                    className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 px-3 py-2"
                    role="alert"
                  >
                    <span className="text-sm text-muted-foreground">
                      {t("common.loadFailed")}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={eventRulesStatus.isFetching}
                      onClick={() => void eventRulesStatus.refetch()}
                    >
                      {t("common.retry")}
                    </Button>
                  </div>
                ) : eventRulesStatusError ? (
                  <p className="text-sm text-destructive" role="status">
                    {eventRulesStatusError}
                  </p>
                ) : null}
                {!eventRulesStatus.isError &&
                !eventRulesStatus.isLoading &&
                !jevConfigured ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {t("settings.eventRulesConnectJev")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("settings.eventRulesFreeBuilderOrApiKey")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <BuilderConnectPopover flow={jevConnectFlow}>
                        <Button
                          type="button"
                          disabled={jevConnectFlow.connecting}
                          aria-busy={jevConnectFlow.connecting}
                          className="h-8 px-3 text-xs"
                        >
                          {jevConnectFlow.connecting
                            ? t("common.connecting")
                            : t("settings.eventRulesConnectBuilder")}
                        </Button>
                      </BuilderConnectPopover>
                      <Link
                        to={buildSettingsRoute("keys:secrets:JEV_API_KEY")}
                        target="_blank"
                        rel="noreferrer"
                        className="whitespace-nowrap text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      >
                        {t("settings.eventRulesAddJevApiKey")}
                      </Link>
                    </div>
                  </div>
                ) : null}
                {eventRulesStatus.isLoading ? (
                  <Skeleton className="h-52 w-full" />
                ) : null}
                {statusData?.accountRefreshErrors.map(({ email, error }) => (
                  <p
                    key={email}
                    className="text-sm text-destructive"
                    role="status"
                  >
                    {email}: {error}
                  </p>
                ))}
                {(["accept", "decline", "hide"] as const).map((rule) => (
                  <div key={rule} className="space-y-2">
                    <Label htmlFor={`event-rule-${rule}`}>
                      {eventRuleLabels[rule]}
                    </Label>
                    <Textarea
                      id={`event-rule-${rule}`}
                      value={eventRules[rule]}
                      onChange={(event) =>
                        setEventRules((current) => ({
                          ...current,
                          [rule]: event.target.value,
                        }))
                      }
                      placeholder={eventRulePlaceholders[rule]}
                      maxLength={2000}
                      rows={2}
                      disabled={!canEditEventRules}
                    />
                  </div>
                ))}
                <Button
                  size="sm"
                  onClick={handleSaveRules}
                  disabled={updateSettings.isPending || !canEditEventRules}
                >
                  {t("settings.eventRulesSave")}
                </Button>
              </TabsContent>
              <TabsContent value="activity">
                {settings?.eventRuleActivity?.length ? (
                  <ul className="mt-2 divide-y">
                    {[...settings.eventRuleActivity].reverse().map((entry) => (
                      <li
                        key={entry.id}
                        className="flex min-w-0 items-center gap-2 py-2 text-xs"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {entry.title || t("eventForm.ai.untitledEvent")}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {eventRuleActivityLabels[entry.action]}
                        </span>
                        <time className="shrink-0 text-muted-foreground">
                          {new Date(entry.occurredAt).toLocaleString(
                            undefined,
                            {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            },
                          )}
                        </time>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 shrink-0 px-2"
                          disabled={undoEventRuleActivity.isPending}
                          onClick={() =>
                            undoEventRuleActivity.mutate({
                              activityId: entry.id,
                            })
                          }
                        >
                          {t("calendarView.undo")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("settings.eventRulesNoActivity")}
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      ),
    },
  ];

  return (
    <SettingsTabsPage
      account={<AccountSettingsCard />}
      generalLabel={t("settings.general")}
      teamLabel={t("navigation.team")}
      extraTabs={settingsTabs}
      generalSearchEntries={generalSearchEntries}
      general={
        <div className="mx-auto max-w-2xl space-y-6 pb-12">
          <p className="text-sm text-muted-foreground">
            {t("settings.description")}
          </p>

          <SettingsGroup>
            <SettingsRow
              id="language"
              label={t("settings.languageTitle")}
              description={t("settings.languageDescription")}
              control={
                <div className="w-56">
                  <LanguagePicker label={t("settings.languageLabel")} />
                </div>
              }
            />
            <SettingsRow
              id="appearance"
              label={t("settings.appearance")}
              description={t("settings.appearanceDescription")}
            >
              <AppearancePicker
                onChange={(preset: AppearancePresetId) => {
                  callAction(
                    "change-appearance" as any,
                    { preset } as any,
                  ).catch(() => {
                    // Server write failed; the local DOM change still stands.
                  });
                }}
              />
            </SettingsRow>
            {notificationPermission !== null ? (
              <SettingsRow
                id="notifications"
                label={t("settings.desktopNotifications")}
                description={t("settings.desktopNotificationsDescription")}
                control={
                  notificationPermission === "granted" ? (
                    <span className="text-sm text-muted-foreground">
                      {t("settings.desktopNotificationsEnabled")}
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleEnableDesktopNotifications()}
                      disabled={notificationPermissionPending}
                    >
                      {t("settings.enableDesktopNotifications")}
                    </Button>
                  )
                }
              />
            ) : null}
            <SettingsRow
              id="availability"
              label={t("bookingLinks.availability")}
              description={t("bookingLinks.availabilityDescription")}
              control={
                <Button variant="outline" size="sm" asChild>
                  <Link to={AVAILABILITY_SETTINGS_PATH}>
                    {t("bookingLinks.availability")}
                  </Link>
                </Button>
              }
            />
          </SettingsGroup>

          {/* Google Calendar Connection */}
          {(googleStatus.isError ||
            googleStatus.data?.connected ||
            googleStatus.data?.configured === true ||
            canOfferGoogleOAuthSetup) && (
            <Card id="google-calendar" className="scroll-mt-16">
              <CardHeader>
                <CardTitle className="text-lg">
                  {t("settings.googleCalendar")}
                </CardTitle>
                <CardDescription>
                  {t("settings.googleDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {googleStatus.data?.connected ? (
                      <>
                        <IconCircleCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        <div>
                          <p className="text-sm font-medium">
                            {t("common.connected")}
                          </p>
                          {googleStatus.data.accounts?.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              {googleStatus.data.accounts
                                .map((a) => a.email)
                                .join(", ")}
                            </p>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <IconCircleX className="h-5 w-5 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          {t("common.notConnected")}
                        </p>
                      </>
                    )}
                  </div>

                  {googleStatus.isError ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void googleStatus.refetch()}
                      disabled={googleStatus.isFetching}
                    >
                      {t("common.retry")}
                    </Button>
                  ) : googleStatus.data?.connected &&
                    googleStatus.data.accounts.some(
                      (account) => !account.shared,
                    ) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDisconnect}
                      disabled={disconnectGoogle.isPending}
                    >
                      <IconUnlink className="me-1.5 h-3.5 w-3.5" />
                      {t("common.disconnect")}
                    </Button>
                  ) : googleStatus.data?.configured === true ||
                    canOfferGoogleOAuthSetup ? (
                    <Button
                      size="sm"
                      onClick={handleConnect}
                      disabled={isGoogleDesktopAuthPending}
                    >
                      <IconExternalLink className="me-1.5 h-3.5 w-3.5" />
                      {t("common.connect")}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          )}

          <Card id="zoom" className="scroll-mt-16">
            <CardHeader>
              <CardTitle className="text-lg">Zoom</CardTitle>
              <CardDescription>{t("settings.zoomDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  {zoomStatus.data?.connected ? (
                    <>
                      <IconCircleCheck className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {t("common.connected")}
                        </p>
                        {zoomStatus.data.accounts?.length > 0 && (
                          <p className="truncate text-xs text-muted-foreground">
                            {zoomStatus.data.accounts
                              .map((a) => a.email || a.displayName || a.id)
                              .join(", ")}
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <IconCircleX className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="text-sm text-muted-foreground">
                          {zoomStatus.data?.configured === false
                            ? t("settings.zoomNotConfigured")
                            : t("common.notConnected")}
                        </p>
                        {zoomStatus.data?.configured === false && (
                          <p className="text-xs text-muted-foreground">
                            {t("settings.zoomCredentialsPrompt")}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {zoomStatus.data?.connected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDisconnectZoom}
                    disabled={disconnectZoom.isPending}
                  >
                    <IconUnlink className="me-1.5 h-3.5 w-3.5" />
                    {t("common.disconnect")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleConnectZoom}
                    disabled={
                      connectZoom.isPending ||
                      zoomStatus.data?.configured === false
                    }
                  >
                    <IconBrandZoom className="me-1.5 h-3.5 w-3.5" />
                    {t("common.connect")}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Google Setup Wizard */}
          {!googleStatus.data?.connected && canOfferGoogleOAuthSetup && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {t("settings.connectGoogleCalendar")}
                </CardTitle>
                <CardDescription>
                  {t("settings.connectGoogleDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <GoogleSetupWizard />
              </CardContent>
            </Card>
          )}

          <Separator />

          {/* General Settings */}
          <Card id="general-settings" className="scroll-mt-16">
            <CardHeader>
              <CardTitle className="text-lg">{t("settings.general")}</CardTitle>
              <CardDescription>
                {t("settings.generalDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="timezone">{t("settings.timezone")}</Label>
                <TimezoneCombobox value={timezone} onChange={setTimezone} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="week-start">
                  {t("settings.weekStartLabel")}
                </Label>
                <Select
                  value={weekStart}
                  onValueChange={(value) => {
                    if (isCalendarWeekStart(value)) setWeekStart(value);
                  }}
                >
                  <SelectTrigger id="week-start" className="w-full sm:w-56">
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
              </div>

              <div className="space-y-2">
                <Label htmlFor="booking-title">
                  {t("settings.bookingTitleLabel")}
                </Label>
                <Input
                  id="booking-title"
                  value={bookingTitle}
                  onChange={(e) => setBookingTitle(e.target.value)}
                  placeholder={t("settings.bookingTitlePlaceholder")}
                />
                <p className="text-xs text-muted-foreground">
                  {t("settings.bookingTitleHelp")}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="booking-desc">
                  {t("settings.bookingDescriptionLabel")}
                </Label>
                <Textarea
                  id="booking-desc"
                  value={bookingDescription}
                  onChange={(e) => setBookingDescription(e.target.value)}
                  placeholder={t("settings.bookingDescriptionPlaceholder")}
                  rows={2}
                />
                <p className="text-xs text-muted-foreground">
                  {t("settings.bookingDescriptionHelp")}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="default-duration">
                  {t("settings.defaultDurationLabel")}
                </Label>
                <Input
                  id="default-duration"
                  type="number"
                  value={defaultDuration}
                  onChange={(e) => setDefaultDuration(Number(e.target.value))}
                  min={5}
                  max={480}
                />
                <p className="text-xs text-muted-foreground">
                  {t("settings.defaultDurationHelp")}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleSave}
                  disabled={updateSettings.isPending}
                >
                  {updateSettings.isPending
                    ? t("common.saving")
                    : t("settings.saveSettings")}
                </Button>
                <Button asChild variant="outline">
                  <Link to="/booking-links">
                    <IconLink className="me-1.5 h-3.5 w-3.5" />
                    {t("navigation.bookingLinks")}
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      }
      team={
        <div className="mx-auto w-full max-w-3xl">
          <TeamPage
            showTitle={false}
            createOrgDescription="Set up a team to share calendars and booking links with your colleagues."
          />
        </div>
      }
      whatsNew={
        <div className="mx-auto w-full max-w-2xl">
          <ChangelogSettingsCard markdown={changelog} />
        </div>
      }
    />
  );
}
