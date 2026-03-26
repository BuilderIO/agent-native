import { useState, useEffect } from "react";
import { ExternalLink, Unlink, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { GoogleSetupWizard } from "@/components/calendar/GoogleSetupWizard";
import { useSettings, useUpdateSettings } from "@/hooks/use-settings";
import {
  useGoogleAuthStatus,
  useGoogleAuthUrl,
  useDisconnectGoogle,
} from "@/hooks/use-google-auth";
import { toast } from "sonner";

export default function Settings() {
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const googleStatus = useGoogleAuthStatus();
  const disconnectGoogle = useDisconnectGoogle();
  const [wantAuthUrl, setWantAuthUrl] = useState(false);
  const authUrl = useGoogleAuthUrl(wantAuthUrl);

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
        onSuccess: () => toast.success("Settings saved"),
        onError: () => toast.error("Failed to save settings"),
      },
    );
  }

  function handleConnect() {
    setWantAuthUrl(true);
  }

  useEffect(() => {
    if (authUrl.data?.url) {
      window.open(authUrl.data.url, "_blank");
      setWantAuthUrl(false);
    }
  }, [authUrl.data]);

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
      toast.success("Google Calendar disconnected");
    } catch {
      toast.error("Failed to disconnect");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your calendar and integrations.
        </p>
      </div>

      {/* Google Calendar Connection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Google Calendar</CardTitle>
          <CardDescription>
            Connect your Google Calendar to sync events.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {googleStatus.data?.connected ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <p className="text-sm font-medium">Connected</p>
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
                  <XCircle className="h-5 w-5 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Not connected</p>
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
                <Unlink className="mr-1.5 h-3.5 w-3.5" />
                Disconnect
              </Button>
            ) : (
              <Button size="sm" onClick={handleConnect}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Connect
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Google Setup Wizard */}
      {!googleStatus.data?.connected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Setup Google Calendar</CardTitle>
            <CardDescription>
              Follow these steps to connect your Google account. Takes about 3
              minutes.
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
          <CardTitle className="text-lg">General</CardTitle>
          <CardDescription>Calendar and booking page settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone</Label>
            <Input
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/New_York"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="booking-title">Booking Page Title</Label>
            <Input
              id="booking-title"
              value={bookingTitle}
              onChange={(e) => setBookingTitle(e.target.value)}
              placeholder="Book a Meeting"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="booking-desc">Booking Page Description</Label>
            <Textarea
              id="booking-desc"
              value={bookingDescription}
              onChange={(e) => setBookingDescription(e.target.value)}
              placeholder="Pick a time that works for you."
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="default-duration">
              Default Event Duration (minutes)
            </Label>
            <Input
              id="default-duration"
              type="number"
              value={defaultDuration}
              onChange={(e) => setDefaultDuration(Number(e.target.value))}
              min={5}
              max={480}
            />
          </div>

          <Button onClick={handleSave} disabled={updateSettings.isPending}>
            {updateSettings.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
