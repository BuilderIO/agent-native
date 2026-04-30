import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  IconCalendarCheck,
  IconX,
  IconExternalLink,
  IconCheck,
  IconCircle,
  IconLoader2,
  IconChevronUp,
  IconUpload,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { agentNativePath, getCallbackOrigin } from "@agent-native/core/client";
import {
  useGoogleAuthStatus,
  useGoogleAuthUrl,
  useGoogleAddAccountUrl,
  useDisconnectGoogle,
} from "@/hooks/use-google-auth";

interface EnvKeyStatus {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
}

const STEPS = [
  {
    title: "Enable the Google Calendar API",
    description:
      "Open Google Cloud Console and click 'Enable' on the Calendar API.",
    url: "https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com",
    linkText: "Enable Calendar API",
  },
  {
    title: "Configure OAuth consent screen",
    description:
      'Set the app name to anything (e.g. "My Calendar"), choose "External" user type, and add your email as a test user. If you see an overview page, consent is already configured — skip to the next step.',
    url: "https://console.cloud.google.com/apis/credentials/consent",
    linkText: "Configure consent screen",
  },
  {
    title: "Create OAuth credentials",
    description:
      '1) Click "+ Create Credentials" → "OAuth client ID"\n2) Choose "Web application"\n3) Add this redirect URI:',
    url: "https://console.cloud.google.com/apis/credentials",
    linkText: "Create credentials",
    showRedirectUri: true,
  },
  {
    title: "Upload credentials JSON",
    description:
      'Click "Download JSON" on the credentials page, then upload it here.',
    showUpload: true,
  },
];

interface GoogleConnectBannerProps {
  variant?: "banner" | "hero";
}

export function GoogleConnectBanner({
  variant = "banner",
}: GoogleConnectBannerProps) {
  const [wantAuthUrl, setWantAuthUrl] = useState(false);
  const [wantAddAccount, setWantAddAccount] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const googleStatus = useGoogleAuthStatus();
  const authUrl = useGoogleAuthUrl(wantAuthUrl);
  const addAccountUrl = useGoogleAddAccountUrl(wantAddAccount);
  const disconnectGoogle = useDisconnectGoogle();

  const accounts = googleStatus.data?.accounts ?? [];
  const hasAccounts = accounts.length > 0;

  const isElectron = useMemo(() => /Electron/i.test(navigator.userAgent), []);
  const desktopPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    return () => {
      if (desktopPollRef.current) clearInterval(desktopPollRef.current);
    };
  }, []);

  function signInViaDesktopBrowser(addAccount = false) {
    const flowId =
      crypto.randomUUID?.() ||
      Math.random().toString(36).slice(2) + Date.now().toString(36);
    const origin = window.location.origin;
    const endpoint = addAccount
      ? "/_agent-native/google/add-account/auth-url"
      : "/_agent-native/google/auth-url";
    const redirectUri = encodeURIComponent(
      `${origin}${agentNativePath("/_agent-native/google/callback")}`,
    );
    window.open(
      `${origin}${agentNativePath(endpoint)}?redirect_uri=${redirectUri}&desktop=1&flow_id=${flowId}&redirect=1`,
      "_blank",
    );
    const start = Date.now();
    if (desktopPollRef.current) clearInterval(desktopPollRef.current);
    desktopPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          agentNativePath(
            `/_agent-native/auth/desktop-exchange?flow_id=${flowId}`,
          ),
        );
        const data = await res.json();
        if (data?.token) {
          clearInterval(desktopPollRef.current!);
          desktopPollRef.current = null;
          await fetch(
            agentNativePath(`/_agent-native/auth/session?_session=${data.token}`),
            {
              credentials: "include",
            },
          );
          window.location.reload();
        } else if (Date.now() - start > 120_000) {
          clearInterval(desktopPollRef.current!);
          desktopPollRef.current = null;
        }
      } catch {
        if (Date.now() - start > 120_000) {
          clearInterval(desktopPollRef.current!);
          desktopPollRef.current = null;
        }
      }
    }, 1500);
  }

  // Wizard state
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [envStatus, setEnvStatus] = useState<EnvKeyStatus[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const redirectUri = `${getCallbackOrigin()}${agentNativePath("/_agent-native/google/callback")}`;

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(agentNativePath("/_agent-native/env-status"));
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

  // Check if credentials are already configured on mount
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // When auth URL is ready, open it and poll for connection.
  // Gate on wantAuthUrl so a cached/refetched URL doesn't open a second
  // popup behind the first when React Query returns stale data immediately
  // and then refetches in the background.
  useEffect(() => {
    if (!wantAuthUrl || !authUrl.data?.url) return;
    setWantAuthUrl(false);
    window.open(authUrl.data.url, "_blank");

    const interval = setInterval(async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/google/status"),
      ).catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        if (data.connected) {
          clearInterval(interval);
          setDismissed(true);
          window.location.reload();
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [wantAuthUrl, authUrl.data]);

  // When auth URL fails with missing credentials, show wizard
  useEffect(() => {
    if (authUrl.error) {
      setWantAuthUrl(false);
      setShowWizard(true);
      fetchStatus();
    }
  }, [authUrl.error, fetchStatus]);

  const allConfigured =
    envStatus.length > 0 && envStatus.every((k) => k.configured);

  // When add-account URL is ready, open it and poll for new account
  useEffect(() => {
    if (!wantAddAccount || !addAccountUrl.data?.url) return;
    window.open(addAccountUrl.data.url, "_blank");
    setWantAddAccount(false);

    const prevCount = accounts.length;
    const interval = setInterval(async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/google/status"),
      ).catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        if (data.accounts?.length > prevCount) {
          clearInterval(interval);
          window.location.reload();
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [wantAddAccount, addAccountUrl.data, accounts.length]);

  function handleConnect() {
    if (isElectron) {
      signInViaDesktopBrowser();
      return;
    }
    setWantAuthUrl(true);
  }

  function handleAddAccount() {
    if (isElectron) {
      signInViaDesktopBrowser(true);
      return;
    }
    setWantAddAccount(true);
  }

  async function handleJsonUpload(file: File) {
    setSaving(true);
    setSaveError(null);

    try {
      const text = await file.text();
      const json = JSON.parse(text);

      const creds = json.web || json.installed || json;
      const clientId = creds.client_id;
      const clientSecret = creds.client_secret;

      if (!clientId || !clientSecret) {
        throw new Error("Could not find client_id and client_secret in JSON");
      }

      const res = await fetch(agentNativePath("/_agent-native/env-vars"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vars: [
            { key: "GOOGLE_CLIENT_ID", value: clientId },
            { key: "GOOGLE_CLIENT_SECRET", value: clientSecret },
          ],
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save credentials");
      }

      setSaved(true);
      await fetchStatus();
      // Reload after a short delay to let Vite restart with new env vars
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to parse JSON");
    } finally {
      setSaving(false);
    }
  }

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  if (dismissed) return null;

  if (variant === "hero") {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-foreground/[0.06]">
          <IconCalendarCheck className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="text-[15px] font-medium text-foreground">
          Connect Google Calendar
        </h2>
        <p className="mt-2 max-w-xs text-[13px] text-muted-foreground leading-relaxed">
          Sync your events and manage your schedule.
        </p>
        <Button
          size="sm"
          className="mt-6 gap-2 px-4 h-8 text-[13px] font-medium"
          onClick={handleConnect}
          disabled={authUrl.isLoading || authUrl.isFetching}
        >
          <GoogleIcon className="h-3.5 w-3.5" />
          {authUrl.isLoading
            ? "Connecting..."
            : hasAccounts
              ? "Add account"
              : allConfigured
                ? "Connect Google"
                : "Set up Google"}
        </Button>

        {hasAccounts && (
          <div className="mt-4 flex items-center gap-2 flex-wrap justify-center">
            {accounts.map((account) => (
              <div
                key={account.email}
                className="group flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <span>{account.email}</span>
                <button
                  onClick={() => disconnectGoogle.mutate(account.email)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-foreground/25 hover:text-foreground/50"
                >
                  <IconX className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {showWizard && !allConfigured && (
          <div className="mt-8 w-full max-w-lg text-left">
            <SetupWizard
              currentStep={currentStep}
              setCurrentStep={setCurrentStep}
              saved={saved}
              allConfigured={allConfigured}
              redirectUri={redirectUri}
              saving={saving}
              saveError={saveError}
              fileInputRef={fileInputRef}
              handleJsonUpload={handleJsonUpload}
              copiedKey={copiedKey}
              copyToClipboard={copyToClipboard}
            />
          </div>
        )}
      </div>
    );
  }

  // Connected with accounts — show compact account strip
  if (hasAccounts) {
    return (
      <div className="border-b border-border/30 bg-card">
        <div className="flex items-center justify-between gap-3 px-4 py-1.5">
          <div className="flex items-center gap-2 min-w-0">
            {accounts.map((account) => (
              <div
                key={account.email}
                className="group flex items-center gap-1.5 text-xs text-foreground/60"
              >
                <span className="truncate">{account.email}</span>
                <button
                  onClick={() => disconnectGoogle.mutate(account.email)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-foreground/30 hover:text-foreground/60"
                >
                  <IconX className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button
              onClick={handleAddAccount}
              disabled={addAccountUrl.isLoading || addAccountUrl.isFetching}
              className="text-xs text-foreground/40 hover:text-foreground/60 transition-colors whitespace-nowrap"
            >
              + Add account
            </button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setDismissed(true)}
          >
            <IconX className="h-3 w-3" />
          </Button>
        </div>
      </div>
    );
  }

  // Not connected or not configured — show setup banner
  return (
    <div className="border-b border-border/30 bg-card">
      {/* Compact banner row */}
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-white/[0.06]">
            <IconCalendarCheck className="h-3 w-3 text-white/40" />
          </div>
          <p className="text-[13px] font-medium leading-tight text-foreground/80">
            {allConfigured
              ? "Ready to connect — sign in with your Google account"
              : "Connect Google to sync your calendar"}
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
              <IconChevronUp className="h-3 w-3" />
              Hide setup
            </Button>
          ) : allConfigured ? (
            <Button
              size="sm"
              className="gap-1.5 text-xs h-7 font-medium bg-white text-black hover:bg-white/90"
              onClick={handleConnect}
              disabled={authUrl.isLoading || authUrl.isFetching}
            >
              <GoogleIcon className="h-3 w-3" />
              {authUrl.isLoading ? "Connecting..." : "Sign in with Google"}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs h-7 font-medium"
              onClick={handleConnect}
              disabled={authUrl.isLoading || authUrl.isFetching}
            >
              {authUrl.isLoading ? "..." : "Set up Google"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={() => setDismissed(true)}
          >
            <IconX className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Inline setup wizard */}
      {showWizard && !allConfigured && (
        <div className="px-5 pb-4 pt-1 max-w-2xl">
          <p className="text-xs text-muted-foreground mb-3">
            Follow these steps to connect your Google account. Takes about 3
            minutes.
          </p>
          <SetupWizard
            currentStep={currentStep}
            setCurrentStep={setCurrentStep}
            saved={saved}
            allConfigured={allConfigured}
            redirectUri={redirectUri}
            saving={saving}
            saveError={saveError}
            fileInputRef={fileInputRef}
            handleJsonUpload={handleJsonUpload}
            copiedKey={copiedKey}
            copyToClipboard={copyToClipboard}
          />
        </div>
      )}
    </div>
  );
}

function SetupWizard({
  currentStep,
  setCurrentStep,
  saved,
  allConfigured,
  redirectUri,
  saving,
  saveError,
  fileInputRef,
  handleJsonUpload,
  copiedKey,
  copyToClipboard,
}: {
  currentStep: number;
  setCurrentStep: (i: number) => void;
  saved: boolean;
  allConfigured: boolean;
  redirectUri: string;
  saving: boolean;
  saveError: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleJsonUpload: (file: File) => void;
  copiedKey: string | null;
  copyToClipboard: (text: string, key: string) => void;
}) {
  return (
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
                  ? "border-border bg-accent"
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
                  <IconCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : isActive ? (
                  <IconCircle className="h-3.5 w-3.5 text-primary fill-primary" />
                ) : (
                  <IconCircle className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  <span className="text-muted-foreground mr-1.5">{i + 1}.</span>
                  {step.title}
                </p>

                {isActive && (
                  <div className="mt-2 space-y-2.5">
                    <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                      {step.description}
                    </p>

                    {step.showRedirectUri && (
                      <div className="flex items-center gap-2">
                        <code className="flex-1 rounded bg-muted px-2 py-1.5 text-xs font-mono break-all select-all">
                          {redirectUri}
                        </code>
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0 text-xs h-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyToClipboard(redirectUri, "redirect");
                          }}
                        >
                          {copiedKey === "redirect" ? (
                            <>
                              <IconCheck className="h-3 w-3" />
                              Copied
                            </>
                          ) : (
                            "Copy"
                          )}
                        </Button>
                      </div>
                    )}

                    {step.url && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs h-7"
                        asChild
                      >
                        <a
                          href={step.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (i < STEPS.length - 1) {
                              setCurrentStep(i + 1);
                            }
                          }}
                        >
                          <IconExternalLink className="h-3 w-3" />
                          {step.linkText}
                        </a>
                      </Button>
                    )}

                    {step.showUpload && !allConfigured && (
                      <div
                        className="space-y-2.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".json"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleJsonUpload(file);
                          }}
                        />
                        {saveError && (
                          <p className="text-xs text-destructive">
                            {saveError}
                          </p>
                        )}
                        <Button
                          size="sm"
                          className="h-7 text-xs gap-1.5"
                          onClick={(e) => {
                            e.stopPropagation();
                            fileInputRef.current?.click();
                          }}
                          disabled={saving}
                        >
                          {saving ? (
                            <IconLoader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <IconUpload className="h-3 w-3" />
                          )}
                          {saving ? "Saving..." : "Upload JSON"}
                        </Button>
                      </div>
                    )}

                    {step.showUpload && allConfigured && (
                      <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                        <IconCheck className="h-3.5 w-3.5" />
                        Credentials configured. Click "Connect Google Calendar"
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
