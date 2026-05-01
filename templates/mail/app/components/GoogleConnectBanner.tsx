import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  IconMail,
  IconX,
  IconExternalLink,
  IconCheck,
  IconCircle,
  IconLoader2,
  IconChevronDown,
  IconChevronUp,
  IconUpload,
  IconAlertTriangle,
  IconLogout,
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
    title: "Enable the Gmail API",
    description:
      "Open Google Cloud Console and click 'Enable' on the Gmail API.",
    url: "https://console.cloud.google.com/flows/enableapi?apiid=gmail.googleapis.com",
    linkText: "Enable Gmail API",
  },
  {
    title: "Enable the People API",
    description:
      "Enable the People API for contact autocomplete when composing emails.",
    url: "https://console.cloud.google.com/flows/enableapi?apiid=people.googleapis.com",
    linkText: "Enable People API",
  },
  {
    title: "Configure OAuth consent screen",
    description:
      'Set the app name to anything (e.g. "My Mail"), choose "External" user type, and add your email as a test user. If you see an overview page, consent is already configured — skip to the next step.',
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

interface DesktopAuthIssue {
  error?: string;
  message?: string;
  code?: string;
  accountId?: string;
  existingOwner?: string;
  attemptedOwner?: string;
}

export function GoogleConnectBanner({
  variant = "banner",
}: GoogleConnectBannerProps) {
  const [wantAuthUrl, setWantAuthUrl] = useState(false);
  const [wantAddAccount, setWantAddAccount] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [desktopAuthIssue, setDesktopAuthIssue] =
    useState<DesktopAuthIssue | null>(null);
  const googleStatus = useGoogleAuthStatus();
  const authUrl = useGoogleAuthUrl(wantAuthUrl);
  const addAccountUrl = useGoogleAddAccountUrl(wantAddAccount);
  const disconnectGoogle = useDisconnectGoogle();

  const accounts = googleStatus.data?.accounts ?? [];
  const hasAccounts = accounts.length > 0;

  const isElectron = useMemo(() => /Electron/i.test(navigator.userAgent), []);
  const desktopPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const authPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const addAccountPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    return () => {
      if (desktopPollRef.current) clearInterval(desktopPollRef.current);
      if (authPollRef.current) clearInterval(authPollRef.current);
      if (addAccountPollRef.current) clearInterval(addAccountPollRef.current);
    };
  }, []);

  function signInViaDesktopBrowser(addAccount = false) {
    setDesktopAuthIssue(null);
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
        if (data?.error) {
          clearInterval(desktopPollRef.current!);
          desktopPollRef.current = null;
          setDesktopAuthIssue(data);
        } else if (data?.token) {
          clearInterval(desktopPollRef.current!);
          desktopPollRef.current = null;
          await fetch(
            agentNativePath(
              `/_agent-native/auth/session?_session=${data.token}`,
            ),
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

  const [authError, setAuthError] = useState<string | null>(null);

  // Wizard state
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [envStatus, setEnvStatus] = useState<EnvKeyStatus[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
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
  //
  // `wantAuthUrl` is the user's retry intent and must be in the deps so a
  // second click after closing the popup re-runs this effect (the cached
  // authUrl.data won't change on its own). The interval lives in a ref so
  // flipping wantAuthUrl false below doesn't tear down an already-running
  // poll. Cleanup happens on unmount via the dedicated effect above.
  useEffect(() => {
    if (!wantAuthUrl || !authUrl.data?.url) return;
    const url = authUrl.data.url;
    setWantAuthUrl(false);
    // In a React Native WebView, window.open() is silently blocked (WKWebView
    // doesn't support it without onOpenWindow). Use postMessage to ask the
    // native wrapper to open the URL in the system browser (Safari).
    const rnWebView = (window as any).ReactNativeWebView;
    const isNativeWebView = typeof rnWebView !== "undefined";
    if (isNativeWebView) {
      rnWebView.postMessage(JSON.stringify({ type: "openUrl", url }));
      return;
    }
    window.open(url, "_blank");

    if (authPollRef.current) clearInterval(authPollRef.current);
    authPollRef.current = setInterval(async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/google/status"),
      ).catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        if (data.connected) {
          if (authPollRef.current) {
            clearInterval(authPollRef.current);
            authPollRef.current = null;
          }
          window.location.reload();
        }
      }
    }, 2000);
  }, [wantAuthUrl, authUrl.data]);

  // When auth URL fails, show wizard (for missing credentials) or an error message
  useEffect(() => {
    if (authUrl.error) {
      setWantAuthUrl(false);
      setShowWizard(true);
      fetchStatus();
      setAuthError(
        (authUrl.error as any)?.message || "Failed to connect. Try again.",
      );
    }
  }, [authUrl.error, fetchStatus]);

  const allConfigured =
    envStatus.length > 0 && envStatus.every((k) => k.configured);

  const handleSignOutForGoogle = useCallback(async () => {
    try {
      await fetch(agentNativePath("/_agent-native/auth/logout"), {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Reload below still lands on the auth screen if the local cookie changed.
    }
    window.location.reload();
  }, []);

  // When add-account URL is ready, open it and poll for new account.
  // Same retry-intent rationale as the connect effect — `wantAddAccount`
  // is in the deps so a second click rerun the effect; the polling
  // interval lives in a ref so flipping wantAddAccount false here doesn't
  // tear down the running poll.
  useEffect(() => {
    if (!wantAddAccount || !addAccountUrl.data?.url) return;
    const isNativeWebView =
      typeof (window as any).ReactNativeWebView !== "undefined";
    if (isNativeWebView) {
      window.location.href = addAccountUrl.data.url;
    } else {
      window.open(addAccountUrl.data.url, "_blank");
    }
    setWantAddAccount(false);

    if (isNativeWebView) return;

    const prevCount = accounts.length;
    if (addAccountPollRef.current) clearInterval(addAccountPollRef.current);
    addAccountPollRef.current = setInterval(async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/google/status"),
      ).catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        if (data.accounts?.length > prevCount) {
          if (addAccountPollRef.current) {
            clearInterval(addAccountPollRef.current);
            addAccountPollRef.current = null;
          }
          window.location.reload();
        }
      }
    }, 2000);
    // accounts.length is captured into prevCount above; including it in deps
    // would tear down and recreate the interval whenever the count changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantAddAccount, addAccountUrl.data]);

  function handleConnect() {
    setDesktopAuthIssue(null);
    if (isElectron) {
      signInViaDesktopBrowser();
      return;
    }
    if (showWizard && allConfigured) {
      setWantAuthUrl(true);
    } else {
      setWantAuthUrl(true);
    }
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

      // Google's downloaded JSON has the credentials nested under "web" or "installed"
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

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  if (dismissed) return null;

  // Full-page hero for setup / reconnection
  if (variant === "hero") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center px-6">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.06]">
          <IconMail className="h-7 w-7 text-white/40" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          Connect your Google account
        </h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground leading-relaxed">
          Send and receive real email. Connect your Gmail account to get
          started.
        </p>
        <Button
          size="sm"
          className="mt-8 gap-2 px-5 h-9 text-sm font-medium bg-white text-black hover:bg-white/90"
          onClick={() => {
            setAuthError(null);
            handleConnect();
          }}
          disabled={authUrl.isLoading || authUrl.isFetching}
        >
          <GoogleIcon className="h-4 w-4" />
          {authUrl.isLoading
            ? "Connecting..."
            : allConfigured
              ? "Sign in with Google"
              : "Set up Google"}
        </Button>

        <GoogleAuthIssuePanel
          issue={desktopAuthIssue}
          onSignOut={handleSignOutForGoogle}
          onDismiss={() => setDesktopAuthIssue(null)}
          className="mt-5 w-full max-w-md"
        />

        {authError && allConfigured && (
          <p className="mt-3 text-xs text-red-400">{authError}</p>
        )}

        {showWizard && !allConfigured && (
          <div className="mt-10 w-full max-w-lg text-left">
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
                        ? "border-white/20 bg-white/[0.03]"
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
                          <IconCheck className="h-3.5 w-3.5 text-green-500" />
                        ) : isActive ? (
                          <IconCircle className="h-3.5 w-3.5 text-white fill-white" />
                        ) : (
                          <IconCircle className="h-3.5 w-3.5 text-muted-foreground" />
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
                                  className="h-7 text-xs gap-1.5 bg-white text-black hover:bg-white/90"
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
                              <div className="flex items-center gap-2 text-xs text-green-500">
                                <IconCheck className="h-3.5 w-3.5" />
                                Credentials configured. Click "Sign in with
                                Google" above to connect.
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
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary/10">
            <IconMail className="h-3 w-3 text-primary/70" />
          </div>
          <p className="text-[13px] font-medium leading-tight text-foreground/80">
            {allConfigured
              ? "Ready to connect — sign in with your Google account"
              : "Connect Google to send and receive real email"}
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
              onClick={() => {
                setAuthError(null);
                handleConnect();
              }}
              disabled={authUrl.isLoading || authUrl.isFetching}
            >
              <GoogleIcon className="h-3 w-3" />
              {authUrl.isFetching ? "Connecting..." : "Sign in with Google"}
            </Button>
          ) : (
            <Button
              size="sm"
              className="gap-1.5 text-xs h-7 font-medium bg-white text-black hover:bg-white/90"
              onClick={handleConnect}
              disabled={authUrl.isLoading || authUrl.isFetching}
            >
              {authUrl.isFetching ? "..." : "Set up Google"}
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

      <GoogleAuthIssuePanel
        issue={desktopAuthIssue}
        onSignOut={handleSignOutForGoogle}
        onDismiss={() => setDesktopAuthIssue(null)}
        className="mx-4 mb-3"
      />

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
                        <IconCheck className="h-3.5 w-3.5 text-green-500" />
                      ) : isActive ? (
                        <IconCircle className="h-3.5 w-3.5 text-primary fill-primary" />
                      ) : (
                        <IconCircle className="h-3.5 w-3.5 text-muted-foreground" />
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
                            <div className="flex items-center gap-2 text-xs text-green-500">
                              <IconCheck className="h-3.5 w-3.5" />
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

function GoogleAuthIssuePanel({
  issue,
  onSignOut,
  onDismiss,
  className = "",
}: {
  issue: DesktopAuthIssue | null;
  onSignOut: () => void;
  onDismiss: () => void;
  className?: string;
}) {
  if (!issue) return null;
  const account = issue.accountId || "that Google account";
  const detail =
    issue.message ||
    issue.error ||
    `Sign out, then sign back in with ${account}.`;
  const shouldOfferSignOut =
    issue.code === "account_owner_mismatch" ||
    Boolean(issue.existingOwner || issue.attemptedOwner || issue.accountId);

  return (
    <div
      className={`rounded-lg border border-amber-500/25 bg-amber-500/[0.07] p-3 text-left ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-300">
          <IconAlertTriangle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            Use the matching Agent Native login
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {detail}
          </p>
          {shouldOfferSignOut && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="h-8 gap-1.5 bg-white px-3 text-xs font-medium text-black hover:bg-white/90"
                onClick={onSignOut}
              >
                <IconLogout className="h-3.5 w-3.5" />
                Sign out
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={onDismiss}
              >
                Dismiss
              </Button>
            </div>
          )}
        </div>
        <button
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-white/5 hover:text-foreground"
          onClick={onDismiss}
          aria-label="Dismiss Google sign-in notice"
        >
          <IconX className="h-3.5 w-3.5" />
        </button>
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
