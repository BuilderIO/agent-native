import {
  agentNativePath,
  isInBuilderFrame,
  oauthRedirectUri,
  useT,
} from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import {
  IconCalendarCheck,
  IconX,
  IconExternalLink,
  IconCheck,
  IconCircle,
  IconLoader2,
  IconChevronUp,
  IconUpload,
  IconAlertTriangle,
  IconLogout,
  IconInfoCircle,
} from "@tabler/icons-react";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";

import {
  useGoogleAuthStatus,
  useGoogleAuthUrl,
  useGoogleAddAccountUrl,
  useGoogleDesktopAuth,
  useDisconnectGoogle,
  type DesktopAuthIssue,
} from "@/hooks/use-google-auth";
import { shouldOfferGoogleOAuthSetup } from "@/lib/google-oauth-setup";

interface EnvKeyStatus {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
}

type CalendarT = ReturnType<typeof useT>;

function getSetupSteps(t: CalendarT) {
  return [
    {
      title: t("googleConnect.steps.enableApi.title"),
      description: t("googleConnect.steps.enableApi.description"),
      url: "https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com",
      linkText: t("googleConnect.steps.enableApi.linkText"),
    },
    {
      title: t("googleConnect.steps.consent.title"),
      description: t("googleConnect.steps.consent.description"),
      url: "https://console.cloud.google.com/apis/credentials/consent",
      linkText: t("googleConnect.steps.consent.linkText"),
    },
    {
      title: t("googleConnect.steps.credentials.title"),
      description: t("googleConnect.steps.credentials.description"),
      url: "https://console.cloud.google.com/apis/credentials",
      linkText: t("googleConnect.steps.credentials.linkText"),
      showRedirectUri: true,
    },
    {
      title: t("googleConnect.steps.upload.title"),
      description: t("googleConnect.steps.upload.description"),
      showUpload: true,
    },
  ];
}

interface GoogleConnectBannerProps {
  variant?: "banner" | "hero";
}

export function GoogleConnectBanner({
  variant = "banner",
}: GoogleConnectBannerProps) {
  const t = useT();
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
  const canOfferOAuthSetup = useMemo(() => shouldOfferGoogleOAuthSetup(), []);

  const isBuilderFrame = useMemo(() => isInBuilderFrame(), []);
  const authPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const addAccountPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const {
    isDesktopGoogleAuth,
    isGoogleDesktopAuthPending,
    startDesktopGoogleAuth,
  } = useGoogleDesktopAuth({
    onError: setDesktopAuthIssue,
    onSuccess: () => window.location.reload(),
  });
  useEffect(() => {
    return () => {
      if (authPollRef.current) clearInterval(authPollRef.current);
      if (addAccountPollRef.current) clearInterval(addAccountPollRef.current);
    };
  }, []);

  // Wizard state
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [envStatus, setEnvStatus] = useState<EnvKeyStatus[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const redirectUri = oauthRedirectUri("/_agent-native/google/callback");
  const setupSteps = useMemo(() => getSetupSteps(t), [t]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(agentNativePath("/_agent-native/env-status"));
      if (res.ok) {
        const data: EnvKeyStatus[] = await res.json();
        setEnvStatus(data);
        const allConfigured = data.every((k) => k.configured);
        if (allConfigured && data.length > 0) {
          setSaved(true);
          setCurrentStep(setupSteps.length - 1);
        }
      }
    } catch {
      // ignore
    }
  }, [setupSteps.length]);

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
  // poll; cleanup happens on unmount via the dedicated effect above.
  useEffect(() => {
    if (!wantAuthUrl || !authUrl.data?.url) return;
    setWantAuthUrl(false);
    if (isBuilderFrame) {
      window.location.href = authUrl.data.url;
      return;
    }
    window.open(authUrl.data.url, "_blank");

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
          setDismissed(true);
          window.location.reload();
        }
      }
    }, 2000);
  }, [wantAuthUrl, authUrl.data, isBuilderFrame]);

  // When auth URL fails with missing credentials, show wizard
  useEffect(() => {
    if (authUrl.error) {
      setWantAuthUrl(false);
      if (canOfferOAuthSetup) {
        setShowWizard(true);
        fetchStatus();
      } else {
        setDesktopAuthIssue({
          code: "managed_credentials_unavailable",
          message: t("googleConnect.managedCredentialsUnavailableDescription"),
        });
      }
    }
  }, [authUrl.error, canOfferOAuthSetup, fetchStatus, t]);

  useEffect(() => {
    if (
      desktopAuthIssue?.code !== "missing_credentials" &&
      desktopAuthIssue?.error !== "missing_credentials"
    ) {
      return;
    }
    setShowWizard(true);
    fetchStatus();
  }, [desktopAuthIssue, fetchStatus]);

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
    if (isBuilderFrame) {
      window.location.href = addAccountUrl.data.url;
      setWantAddAccount(false);
      return;
    }
    window.open(addAccountUrl.data.url, "_blank");
    setWantAddAccount(false);

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
  }, [wantAddAccount, addAccountUrl.data, isBuilderFrame]);

  function handleConnect() {
    setDesktopAuthIssue(null);
    if (isDesktopGoogleAuth) {
      startDesktopGoogleAuth({ previousAccountCount: accounts.length });
      return;
    }
    setWantAuthUrl(true);
  }

  function handleAddAccount() {
    if (isDesktopGoogleAuth) {
      startDesktopGoogleAuth({
        addAccount: true,
        previousAccountCount: accounts.length,
      });
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
        throw new Error(t("googleConnect.missingClientCredentials"));
      }

      const res = await fetch(agentNativePath("/_agent-native/env-vars"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "workspace",
          vars: [
            { key: "GOOGLE_CLIENT_ID", value: clientId },
            { key: "GOOGLE_CLIENT_SECRET", value: clientSecret },
          ],
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t("googleConnect.failedSaveCredentials"));
      }

      setSaved(true);
      await fetchStatus();
      // Reload after the server has persisted the scoped credentials.
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : t("googleConnect.failedParseJson"),
      );
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
          {t("googleConnect.connectGoogleCalendar")}
        </h2>
        <p className="mt-2 max-w-xs text-[13px] text-muted-foreground leading-relaxed">
          {t("googleConnect.syncEventsDescription")}
        </p>
        <Button
          size="sm"
          className="mt-6 gap-2 px-4 h-8 text-[13px] font-medium"
          onClick={handleConnect}
          disabled={
            authUrl.isLoading ||
            authUrl.isFetching ||
            isGoogleDesktopAuthPending
          }
        >
          <GoogleIcon className="h-3.5 w-3.5" />
          {authUrl.isLoading
            ? t("common.connecting")
            : hasAccounts
              ? t("googleConnect.addAccount")
              : allConfigured
                ? t("googleConnect.connectGoogle")
                : t("googleConnect.connectGoogle")}
        </Button>

        <GoogleVerificationNotice className="mt-3" />

        <GoogleAuthIssuePanel
          issue={desktopAuthIssue}
          onSignOut={handleSignOutForGoogle}
          onDismiss={() => setDesktopAuthIssue(null)}
          className="mt-5 w-full max-w-md"
        />

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

        {showWizard && !allConfigured && canOfferOAuthSetup && (
          <div className="mt-8 w-full max-w-lg text-start">
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
              steps={setupSteps}
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
              disabled={
                addAccountUrl.isLoading ||
                addAccountUrl.isFetching ||
                isGoogleDesktopAuthPending
              }
              className="text-xs text-foreground/40 hover:text-foreground/60 transition-colors whitespace-nowrap"
            >
              {t("googleConnect.addAccountWithPlus")}
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
        <GoogleAuthIssuePanel
          issue={desktopAuthIssue}
          onSignOut={handleSignOutForGoogle}
          onDismiss={() => setDesktopAuthIssue(null)}
          className="mx-4 mb-3"
        />
      </div>
    );
  }

  // Not connected or not configured — show setup banner
  return (
    <div className="border-b border-border/30 bg-card">
      {/* Compact banner row */}
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-white/[0.06]">
            <IconCalendarCheck className="h-3 w-3 text-white/40" />
          </div>
          <div className="flex min-w-0 flex-col">
            <p className="text-[13px] font-medium leading-tight text-foreground/80">
              {allConfigured
                ? t("googleConnect.readyToConnect")
                : t("googleConnect.connectToSync")}
            </p>
            <GoogleVerificationNotice className="mt-0.5" />
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {showWizard && !allConfigured && canOfferOAuthSetup ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs h-7 font-medium"
              onClick={() => setShowWizard(false)}
            >
              <IconChevronUp className="h-3 w-3" />
              {t("googleConnect.hideSetup")}
            </Button>
          ) : allConfigured ? (
            <Button
              size="sm"
              className="gap-1.5 text-xs h-7 font-medium bg-white text-black hover:bg-white/90"
              onClick={handleConnect}
              disabled={
                authUrl.isLoading ||
                authUrl.isFetching ||
                isGoogleDesktopAuthPending
              }
            >
              <GoogleIcon className="h-3 w-3" />
              {authUrl.isLoading
                ? t("common.connecting")
                : t("googleConnect.signInWithGoogle")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs h-7 font-medium"
              onClick={handleConnect}
              disabled={
                authUrl.isLoading ||
                authUrl.isFetching ||
                isGoogleDesktopAuthPending
              }
            >
              {authUrl.isLoading ? "..." : t("googleConnect.connectGoogle")}
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
      {showWizard && !allConfigured && canOfferOAuthSetup && (
        <div className="px-5 pb-4 pt-1 max-w-2xl">
          <p className="text-xs text-muted-foreground mb-3">
            {t("googleConnect.followSteps")}
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
            steps={setupSteps}
          />
        </div>
      )}
    </div>
  );
}

// Heads-up popover: Google shows a "hasn't verified this app" warning during
// the OAuth consent flow because the connection runs through the user's own
// Google Cloud project (External + Testing), not a Google-reviewed public app.
// This explains that the warning is expected and how to safely continue.
function GoogleVerificationNotice({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 transition-colors hover:text-muted-foreground ${className}`}
        >
          <IconInfoCircle className="h-3 w-3" />
          {t("googleConnect.googleMayShowWarning")}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-72 text-start">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-300">
            <IconAlertTriangle className="h-3.5 w-3.5" />
          </div>
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium text-foreground">
              {t("googleConnect.googleNotVerifiedTitle")}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("googleConnect.googleWarningBeforeAdvanced")}{" "}
              <span className="font-medium text-foreground">
                {t("googleConnect.googleWarningAdvanced")}
              </span>
              {t("googleConnect.googleWarningBetweenActions")}{" "}
              <span className="font-medium text-foreground">
                {t("googleConnect.googleWarningUnsafe")}
              </span>{" "}
              {t("googleConnect.googleWarningAfterUnsafe")}
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
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
  const t = useT();
  if (!issue) return null;
  const account = issue.accountId || t("googleConnect.thatGoogleAccount");
  const isOwnerMismatch = issue.code === "account_owner_mismatch";
  const detail = isOwnerMismatch
    ? t("googleConnect.signOutThenSignIn", { account })
    : issue.message ||
      issue.error ||
      t("googleConnect.signOutThenSignIn", { account });
  const shouldOfferSignOut =
    isOwnerMismatch ||
    Boolean(issue.existingOwner || issue.attemptedOwner || issue.accountId);

  return (
    <div
      className={`rounded-lg border border-amber-500/25 bg-amber-500/[0.07] p-3 text-start ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-300">
          <IconAlertTriangle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {isOwnerMismatch
              ? t("googleConnect.accountConnectedElsewhere")
              : t("googleConnect.googleConnectionFailed")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {detail}
          </p>
          {shouldOfferSignOut && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="h-8 gap-1.5 px-3 text-xs font-medium"
                onClick={onSignOut}
              >
                <IconLogout className="h-3.5 w-3.5 rtl:-scale-x-100" />
                {t("googleConnect.signOut")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={onDismiss}
              >
                {t("googleConnect.dismiss")}
              </Button>
            </div>
          )}
        </div>
        <button
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-white/5 hover:text-foreground"
          onClick={onDismiss}
          aria-label={t("googleConnect.dismissNotice")}
        >
          <IconX className="h-3.5 w-3.5" />
        </button>
      </div>
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
  steps,
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
  steps: ReturnType<typeof getSetupSteps>;
}) {
  const t = useT();
  return (
    <div className="space-y-3">
      {steps.map((step, i) => {
        const isActive = i === currentStep;
        const isCompleted =
          i < currentStep || (i === steps.length - 1 && saved);

        return (
          <div
            key={i}
            role="button"
            tabIndex={0}
            className={`w-full text-start rounded-lg border p-3 transition-colors cursor-pointer ${
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
                  <span className="text-muted-foreground me-1.5">{i + 1}.</span>
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
                              {t("googleConnect.copied")}
                            </>
                          ) : (
                            t("googleConnect.copy")
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
                            if (i < steps.length - 1) {
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
                          {saving
                            ? t("common.saving")
                            : t("googleConnect.uploadJson")}
                        </Button>
                      </div>
                    )}

                    {step.showUpload && allConfigured && (
                      <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                        <IconCheck className="h-3.5 w-3.5" />
                        {t("googleConnect.credentialsConfiguredSignIn")}
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
