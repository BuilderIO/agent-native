import { useState, useEffect } from "react";
import { CalendarCheck, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGoogleAuthUrl } from "@/hooks/use-google-auth";

interface GoogleConnectBannerProps {
  variant?: "banner" | "hero";
}

export function GoogleConnectBanner({
  variant = "banner",
}: GoogleConnectBannerProps) {
  const [wantAuthUrl, setWantAuthUrl] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const authUrl = useGoogleAuthUrl(wantAuthUrl);

  useEffect(() => {
    if (authUrl.data?.url) {
      window.open(authUrl.data.url, "_blank");
      setWantAuthUrl(false);
    }
  }, [authUrl.data]);

  if (dismissed) return null;

  if (variant === "hero") {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
          <CalendarCheck className="h-10 w-10 text-primary" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">
          Connect Google Calendar
        </h2>
        <p className="mt-3 max-w-sm text-sm text-muted-foreground leading-relaxed">
          Sync your events, create meetings, and manage your entire schedule in
          one place. Your calendar, supercharged.
        </p>
        <Button
          size="lg"
          className="mt-8 gap-2.5 px-6 font-semibold"
          onClick={() => setWantAuthUrl(true)}
          disabled={authUrl.isLoading || authUrl.isFetching}
        >
          <GoogleIcon />
          {authUrl.isLoading ? "Connecting…" : "Connect Google Calendar"}
        </Button>
        <p className="mt-4 text-xs text-muted-foreground">
          Or press{" "}
          <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">
            C
          </kbd>{" "}
          to add events manually
        </p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-5 py-3.5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/20">
            <CalendarCheck className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">
              Connect Google Calendar
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Sync events, create meetings, and manage your schedule in
              real-time.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            className="gap-2 font-semibold"
            onClick={() => setWantAuthUrl(true)}
            disabled={authUrl.isLoading || authUrl.isFetching}
          >
            <GoogleIcon className="h-3.5 w-3.5" />
            {authUrl.isLoading ? "Connecting…" : "Connect Google Calendar"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setDismissed(true)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
