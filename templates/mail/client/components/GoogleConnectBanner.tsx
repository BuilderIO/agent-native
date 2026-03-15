import { useState, useEffect, useCallback } from "react";
import {
  Mail,
  X,
  ExternalLink,
  Check,
  Circle,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useGoogleAuthStatus,
  useGoogleAuthUrl,
} from "@/hooks/use-google-auth";

interface EnvKeyStatus {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
}

const STEPS = [
  {
    title: "Enable the Gmail API",
    description: "Open Google Cloud Console and click 'Enable' on the Gmail API.",
    url: "https://console.cloud.google.com/flows/enableapi?apiid=gmail.googleapis.com",
    linkText: "Enable Gmail API",
  },
  {
    title: "Configure OAuth consent screen",
    description:
      'Set the app name to anything (e.g. "My Mail"), choose "External" user type, and add your email as a test user.',
    url: "https://console.cloud.google.com/auth/branding",
    linkText: "Configure consent screen",
  },
  {
    title: "Create OAuth credentials",
    description:
      'Click "Create OAuth client", choose "Web application", and add this redirect URI:',
    url: "https://console.cloud.google.com/apis/credentials/oauthclient",
    linkText: "Create credentials",
    showRedirectUri: true,
  },
  {
    title: "Paste your credentials",
    description: "Copy the Client ID and Client Secret from the previous step.",
    showInputs: true,
  },
];

export function GoogleConnectBanner() {
  const [wantAuthUrl, setWantAuthUrl] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const googleStatus = useGoogleAuthStatus();
  const authUrl = useGoogleAuthUrl(wantAuthUrl);

  // Wizard state
  const [currentStep, setCurrentStep] = useState(0);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [envStatus, setEnvStatus] = useState<EnvKeyStatus[]>([]);

  const redirectUri = `${window.location.origin}/api/google/callback`;

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/env-status");
      if (res.ok) {
        const data: EnvKeyStatus[] = await res.json();
        setEnvStatus(data);
        const allConfigured = data.every((k) => k.configured);
        if (allConfigured && data.length > 0) {
          setSaved(true);
          setCurrentStep(STEPS.length - 1);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // When auth URL is ready, open it
  useEffect(() => {
    if (authUrl.data?.url) {
      window.open(authUrl.data.url, "_blank");
      setWantAuthUrl(false);
    }
  }, [authUrl.data]);

  // When auth URL fails with missing credentials, show wizard instead of error toast
  useEffect(() => {
    if (authUrl.error) {
      setWantAuthUrl(false);
      setShowWizard(true);
      fetchStatus();
    }
  }, [authUrl.error, fetchStatus]);

  const allConfigured =
    envStatus.length > 0 && envStatus.every((k) => k.configured);

  function handleConnect() {
    if (showWizard && allConfigured) {
      // Credentials are set, try connecting
      setWantAuthUrl(true);
    } else {
      // Try to connect — if it fails, wizard will open
      setWantAuthUrl(true);
    }
  }

  async function handleSave() {
    if (!clientId.trim() || !clientSecret.trim()) return;

    setSaving(true);
    setSaveError(null);

    try {
      const res = await fetch("/api/env-vars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vars: [
            { key: "GOOGLE_CLIENT_ID", value: clientId.trim() },
            { key: "GOOGLE_CLIENT_SECRET", value: clientSecret.trim() },
          ],
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save credentials");
      }

      setSaved(true);
      setClientId("");
      setClientSecret("");
      await fetchStatus();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function copyRedirectUri() {
    navigator.clipboard.writeText(redirectUri);
  }

  if (dismissed || googleStatus.data?.connected) return null;

  return (
    <div className="border-b border-border bg-gradient-to-r from-primary/8 via-primary/4 to-transparent">
      {/* Compact banner row */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/15">
            <Mail className="h-3.5 w-3.5 text-primary" />
          </div>
          <p className="text-sm font-medium leading-tight">
            Connect Google to send and receive real email
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {showWizard && !allConfigured ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs h-7 font-medium"
              onClick={() => setShowWizard(false)}
            >
              <ChevronUp className="h-3 w-3" />
              Hide setup
            </Button>
          ) : (
            <Button
              size="sm"
              className="gap-1.5 text-xs h-7 font-medium"
              onClick={handleConnect}
              disabled={authUrl.isLoading || authUrl.isFetching}
            >
              <GoogleIcon className="h-3 w-3" />
              {authUrl.isFetching
                ? "Connecting..."
                : allConfigured
                  ? "Connect Google"
                  : "Set up Google"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={() => setDismissed(true)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Inline setup wizard */}
      {showWizard && !allConfigured && (
        <div className="px-4 pb-4 pt-1 max-w-2xl">
          <p className="text-xs text-muted-foreground mb-3">
            Follow these steps to connect your Google account. Takes about 3
            minutes.
          </p>
          <div className="space-y-3">
            {STEPS.map((step, i) => {
              const isActive = i === currentStep;
              const isCompleted =
                i < currentStep || (i === STEPS.length - 1 && saved);

              return (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  className={`w-full text-left rounded-lg border p-3 transition-colors cursor-pointer ${
                    isActive
                      ? "border-primary/40 bg-primary/5"
                      : isCompleted
                        ? "border-green-500/20 bg-green-500/5"
                        : "border-border/50 opacity-50"
                  }`}
                  onClick={() => !saved && setCurrentStep(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      !saved && setCurrentStep(i);
                    }
                  }}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 shrink-0">
                      {isCompleted ? (
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      ) : isActive ? (
                        <Circle className="h-3.5 w-3.5 text-primary fill-primary" />
                      ) : (
                        <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">
                        <span className="text-muted-foreground mr-1.5">
                          {i + 1}.
                        </span>
                        {step.title}
                      </p>

                      {isActive && (
                        <div className="mt-2 space-y-2.5">
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {step.description}
                          </p>

                          {step.showRedirectUri && (
                            <div className="flex items-center gap-2">
                              <code className="flex-1 rounded bg-muted px-2 py-1.5 text-xs font-mono break-all">
                                {redirectUri}
                              </code>
                              <Button
                                variant="outline"
                                size="sm"
                                className="shrink-0 text-xs h-7"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyRedirectUri();
                                }}
                              >
                                Copy
                              </Button>
                            </div>
                          )}

                          {step.url && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 text-xs h-7"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(step.url, "_blank");
                                if (i < STEPS.length - 1) {
                                  setCurrentStep(i + 1);
                                }
                              }}
                            >
                              <ExternalLink className="h-3 w-3" />
                              {step.linkText}
                            </Button>
                          )}

                          {step.showInputs && !allConfigured && (
                            <div
                              className="space-y-2.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="space-y-1.5">
                                <Label
                                  htmlFor="mail-client-id"
                                  className="text-xs text-muted-foreground"
                                >
                                  Client ID
                                </Label>
                                <Input
                                  id="mail-client-id"
                                  value={clientId}
                                  onChange={(e) => setClientId(e.target.value)}
                                  placeholder="123456789.apps.googleusercontent.com"
                                  className="text-xs h-8 font-mono"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label
                                  htmlFor="mail-client-secret"
                                  className="text-xs text-muted-foreground"
                                >
                                  Client Secret
                                </Label>
                                <Input
                                  id="mail-client-secret"
                                  type="password"
                                  value={clientSecret}
                                  onChange={(e) =>
                                    setClientSecret(e.target.value)
                                  }
                                  placeholder="GOCSPX-..."
                                  className="text-xs h-8 font-mono"
                                />
                              </div>
                              {saveError && (
                                <p className="text-xs text-destructive">
                                  {saveError}
                                </p>
                              )}
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSave();
                                }}
                                disabled={
                                  saving ||
                                  !clientId.trim() ||
                                  !clientSecret.trim()
                                }
                              >
                                {saving && (
                                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                                )}
                                {saving ? "Saving..." : "Save credentials"}
                              </Button>
                            </div>
                          )}

                          {step.showInputs && allConfigured && (
                            <div className="flex items-center gap-2 text-xs text-green-500">
                              <Check className="h-3.5 w-3.5" />
                              Credentials configured. Click "Connect Google"
                              above to sign in.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
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
