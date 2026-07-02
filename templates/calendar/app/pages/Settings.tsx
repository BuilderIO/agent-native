import {
  AppearancePicker,
  callAction,
  ChangelogSettingsCard,
  LanguagePicker,
  SettingsTabsPage,
  openAgentSettings,
  type AppearancePresetId,
  useT,
} from "@agent-native/core/client";
import { TeamPage } from "@agent-native/core/client/org";
import {
  IconBrandZoom,
  IconExternalLink,
  IconLink,
  IconUnlink,
  IconCircleCheck,
  IconCircleX,
} from "@tabler/icons-react";
import { useState, useEffect } from "react";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  useGoogleAuthStatus,
  useGoogleAuthUrl,
  useGoogleDesktopAuth,
  useDisconnectGoogle,
} from "@/hooks/use-google-auth";
import { useSettings, useUpdateSettings } from "@/hooks/use-settings";
import {
  useConnectZoom,
  useDisconnectZoom,
  useZoomStatus,
} from "@/hooks/use-zoom-auth";
import { shouldOfferGoogleOAuthSetup } from "@/lib/google-oauth-setup";

import changelog from "../../CHANGELOG.md?raw";

export default function Settings() {
  const t = useT();
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
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
  const [wantAuthUrl, setWantAuthUrl] = useState(false);
  const authUrl = useGoogleAuthUrl(wantAuthUrl);
  const canOfferGoogleOAuthSetup = shouldOfferGoogleOAuthSetup();

  const [timezone, setTimezone] = useState("");
  const [bookingTitle, setBookingTitle] = useState("");
  const [bookingDescription, setBookingDescription] = useState("");
  const [defaultDuration, setDefaultDuration] = useState(30);

  useEffect(() => {
    if (settings) {
      setTimezone(settings.timezone);
      setBookingTitle(settings.bookingPageTitle);
      setBookingDescription(settings.bookingPageDescription);
      setDefaultDuration(settings.defaultEventDuration);
    }
  }, [settings]);

  function handleSave() {
    updateSettings.mutate(
      {
        timezone,
        bookingPageTitle: bookingTitle,
        bookingPageDescription: bookingDescription,
        defaultEventDuration: defaultDuration,
      },
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
    setWantAuthUrl(true);
  }

  useEffect(() => {
    if (!wantAuthUrl || !authUrl.data?.url) return;
    setWantAuthUrl(false);
    window.open(authUrl.data.url, "_blank");
  }, [wantAuthUrl, authUrl.data]);

  useEffect(() => {
    if (authUrl.error) {
      toast.error(authUrl.error.message);
      setWantAuthUrl(false);
    }
  }, [authUrl.error]);

  async function handleDisconnect() {
    const accounts = googleStatus.data?.accounts ?? [];
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

  function handleDisconnectZoom() {
    disconnectZoom.mutate(undefined, {
      onSuccess: () => toast.success(t("settings.zoomDisconnected")),
      onError: () => toast.error(t("settings.zoomDisconnectFailed")),
    });
  }

  return (
    <SettingsTabsPage
      generalLabel={t("settings.general")}
      teamLabel={t("navigation.team")}
      general={
        <div className="mx-auto max-w-2xl space-y-6 pb-12">
          <p className="text-sm text-muted-foreground">
            {t("settings.description")}
          </p>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {t("settings.languageTitle")}
              </CardTitle>
              <CardDescription>
                {t("settings.languageDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="max-w-xs space-y-1.5">
              <Label>{t("settings.languageLabel")}</Label>
              <LanguagePicker label={t("settings.languageLabel")} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {t("settings.agentTitle")}
              </CardTitle>
              <CardDescription>
                {t("settings.agentDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => openAgentSettings()}>
                {t("settings.openAgentSettings")}
              </Button>
            </CardContent>
          </Card>

          {/* Google Calendar Connection */}
          <Card>
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

                {googleStatus.data?.connected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDisconnect}
                    disabled={disconnectGoogle.isPending}
                  >
                    <IconUnlink className="me-1.5 h-3.5 w-3.5" />
                    {t("common.disconnect")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleConnect}
                    disabled={
                      authUrl.isLoading ||
                      authUrl.isFetching ||
                      isGoogleDesktopAuthPending
                    }
                  >
                    <IconExternalLink className="me-1.5 h-3.5 w-3.5" />
                    {t("common.connect")}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
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
          <Card>
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

          {/* Appearance */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {t("settings.appearance")}
              </CardTitle>
              <CardDescription>
                {t("settings.appearanceDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AppearancePicker
                onChange={(preset: AppearancePresetId) => {
                  // Persist server-side so the choice survives reload and syncs
                  // across devices; the local UI has already updated optimistically.
                  callAction(
                    "change-appearance" as any,
                    { preset } as any,
                  ).catch(() => {
                    // Server write failed; the local DOM change still stands.
                  });
                }}
              />
            </CardContent>
          </Card>
        </div>
      }
      team={
        <div className="mx-auto w-full max-w-2xl">
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
