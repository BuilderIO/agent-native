import { agentNativePath, appApiPath, useT } from "@agent-native/core/client";
import {
  IconExternalLink,
  IconCheck,
  IconCircle,
  IconLoader2,
  IconUpload,
  IconPlugOff,
  IconRefresh,
} from "@tabler/icons-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useNotionConnection, useDisconnectNotion } from "@/hooks/use-notion";
import { cn } from "@/lib/utils";

// ─── Notion SVG icon ────────────────────────────────────────────────────────

function NotionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={cn("notion-logo-icon", className)}>
      <path
        className="notion-logo-icon-face"
        d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z"
      />
      <path
        className="notion-logo-icon-mark"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L74.167 3.143c-4.273 -3.107 -6.02 -3.5 -12.817 -2.917zM25.92 19.523c-5.247 0.353 -6.437 0.433 -9.417 -1.99L8.927 11.507c-0.77 -0.78 -0.383 -1.753 1.557 -1.947l53.193 -3.887c4.467 -0.39 6.793 1.167 8.54 2.527l9.123 6.61c0.39 0.197 1.36 1.36 0.193 1.36l-54.933 3.307 -0.68 0.047zM19.803 88.3V30.367c0 -2.53 0.777 -3.697 3.103 -3.893L86 22.78c2.14 -0.193 3.107 1.167 3.107 3.693v57.547c0 2.53 -0.39 4.67 -3.883 4.863l-60.377 3.5c-3.493 0.193 -5.043 -0.97 -5.043 -4.083zm59.6 -54.827c0.387 1.75 0 3.5 -1.75 3.7l-2.91 0.577v42.773c-2.527 1.36 -4.853 2.137 -6.797 2.137 -3.107 0 -3.883 -0.973 -6.21 -3.887l-19.03 -29.94v28.967l6.02 1.363s0 3.5 -4.857 3.5l-13.39 0.777c-0.39 -0.78 0 -2.723 1.357 -3.11l3.497 -0.97v-38.3L30.48 40.667c-0.39 -1.75 0.58 -4.277 3.3 -4.473l14.367 -0.967 19.8 30.327v-26.83l-5.047 -0.58c-0.39 -2.143 1.163 -3.7 3.103 -3.89l13.4 -0.78z"
      />
    </svg>
  );
}

// ─── OAuth wizard steps ─────────────────────────────────────────────────────

const OAUTH_STEPS = [
  {
    titleKey: "sidebar.notionCreateIntegration",
    descriptionKey: "sidebar.notionCreateIntegrationDescription",
    url: "https://www.notion.so/profile/integrations",
    linkTextKey: "sidebar.notionOpenIntegrations",
  },
  {
    titleKey: "sidebar.notionConfigurePublicIntegration",
    descriptionKey: "sidebar.notionConfigurePublicIntegrationDescription",
    showRedirectUri: true,
  },
  {
    titleKey: "sidebar.notionCopyOAuthCredentials",
    descriptionKey: "sidebar.notionCopyOAuthCredentialsDescription",
    showUpload: true,
  },
  {
    titleKey: "sidebar.notionConnectWorkspace",
    descriptionKey: "sidebar.notionConnectWorkspaceDescription",
    showConnect: true,
  },
];

interface EnvKeyStatus {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function NotionButton() {
  const t = useT();
  const { data: connection, refetch } = useNotionConnection();
  const disconnectNotion = useDisconnectNotion();
  const [open, setOpen] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [envStatus, setEnvStatus] = useState<EnvKeyStatus[]>([]);

  const isConnected = connection?.connected ?? false;
  const needsCredentials = connection?.error === "missing_credentials";

  const fetchEnvStatus = useCallback(async () => {
    try {
      const res = await fetch(agentNativePath("/_agent-native/env-status"));
      if (res.ok) setEnvStatus(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    if (showWizard) fetchEnvStatus();
  }, [showWizard, fetchEnvStatus]);

  const oauthConfigured =
    envStatus.filter((k) => k.key.startsWith("NOTION_CLIENT")).length > 0 &&
    envStatus
      .filter((k) => k.key.startsWith("NOTION_CLIENT"))
      .every((k) => k.configured);

  const redirectUri =
    typeof window !== "undefined"
      ? `${window.location.origin}${appApiPath("/api/notion/callback")}`
      : "";

  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  function handleConnect() {
    if (!connection?.authUrl) {
      if (needsCredentials) {
        setShowWizard(true);
        return;
      }
      toast.error(t("sidebar.notionOAuthNotConfigured"));
      return;
    }
    window.open(connection.authUrl, "_blank");

    // Clear any existing poll before starting a new one
    if (pollRef.current) clearInterval(pollRef.current);
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);

    // Poll for connection
    pollRef.current = setInterval(async () => {
      const res = await fetch(appApiPath("/api/notion/status")).catch(
        () => null,
      );
      if (res?.ok) {
        const data = await res.json();
        if (data.connected) {
          clearInterval(pollRef.current);
          pollRef.current = undefined;
          setShowWizard(false);
          setOpen(false);
          refetch();
        }
      }
    }, 2000);

    // Stop polling after 5 minutes
    pollTimeoutRef.current = setTimeout(() => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = undefined;
    }, 300_000);
  }

  async function handleDisconnect() {
    try {
      await disconnectNotion.mutateAsync();
      toast.success(t("sidebar.notionDisconnectedWorkspace"));
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("sidebar.notionDisconnectFailed"),
      );
    }
  }

  async function handleJsonUpload(file: File) {
    setSaving(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const clientId = json.client_id || json.oauth_client_id;
      const clientSecret = json.client_secret || json.oauth_client_secret;
      if (!clientId || !clientSecret) {
        throw new Error(t("sidebar.notionCredentialsNotFound"));
      }
      const res = await fetch(agentNativePath("/_agent-native/env-vars"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "workspace",
          vars: [
            { key: "NOTION_CLIENT_ID", value: clientId },
            { key: "NOTION_CLIENT_SECRET", value: clientSecret },
          ],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t("sidebar.notionCredentialsSaveFailed"));
      }
      await fetchEnvStatus();
      toast.success(t("sidebar.notionCredentialsSavedReloading"));
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("sidebar.notionParseJsonFailed"),
      );
    } finally {
      setSaving(false);
    }
  }

  // ─── Wizard UI ──────────────────────────────────────────────────────────

  if (showWizard) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setOpen(true)}
              >
                <NotionIcon className="h-4 w-4" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("sidebar.notionConnect")}</TooltipContent>
        </Tooltip>
        <PopoverContent
          side="right"
          align="end"
          sideOffset={8}
          className="w-96 p-0 max-h-[80vh] overflow-y-auto"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">
                  {t("sidebar.notionConnect")}
                </h3>
              </div>
              <button
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setShowWizard(false);
                  setOpen(false);
                }}
              >
                {t("comments.cancel")}
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("sidebar.notionConfigureOAuthAuthorize")}
            </p>
          </div>

          {/* ─── OAuth setup ────────────────────────────────── */}
          <div className="p-4 space-y-3">
            {OAUTH_STEPS.map((step, i) => {
              const completed = i < currentStep || (i === 2 && oauthConfigured);
              const active = i === currentStep;

              return (
                <div
                  key={i}
                  className={cn(
                    "rounded-lg border px-3 py-2.5",
                    active ? "border-border bg-muted/50" : "border-transparent",
                  )}
                >
                  <button
                    className="flex items-start gap-2 w-full text-start"
                    onClick={() => setCurrentStep(i)}
                  >
                    <span className="mt-0.5 shrink-0">
                      {completed ? (
                        <IconCheck size={14} className="text-emerald-500" />
                      ) : active ? (
                        <IconCircle
                          size={14}
                          className="text-foreground"
                          fill="currentColor"
                        />
                      ) : (
                        <IconCircle
                          size={14}
                          className="text-muted-foreground"
                        />
                      )}
                    </span>
                    <span
                      className={cn(
                        "text-xs font-medium",
                        active
                          ? "text-foreground"
                          : completed
                            ? "text-muted-foreground"
                            : "text-muted-foreground",
                      )}
                    >
                      {t(step.titleKey)}
                    </span>
                  </button>

                  {active && (
                    <div className="mt-2 ms-5 space-y-2">
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {t(step.descriptionKey)}
                      </p>

                      {step.url && (
                        <a
                          href={step.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <IconExternalLink size={11} />
                          {step.linkTextKey ? t(step.linkTextKey) : null}
                        </a>
                      )}

                      {step.showRedirectUri && (
                        <div className="flex items-center gap-1">
                          <code className="flex-1 rounded bg-muted px-2 py-1 text-[10px] font-mono text-foreground break-all">
                            {redirectUri}
                          </code>
                          <button
                            className="shrink-0 rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent"
                            onClick={() => {
                              navigator.clipboard.writeText(redirectUri);
                              toast.success(t("sidebar.copied"));
                            }}
                          >
                            {t("sidebar.copy")}
                          </button>
                        </div>
                      )}

                      {step.showUpload && (
                        <div className="space-y-2">
                          <label className="flex items-center gap-2 cursor-pointer rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground">
                            <IconUpload size={14} />
                            {saving
                              ? t("sidebar.saving")
                              : t("sidebar.notionUploadCredentialsJson")}
                            <input
                              type="file"
                              accept=".json"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleJsonUpload(file);
                              }}
                            />
                          </label>
                          {envStatus
                            .filter((k) => k.key.startsWith("NOTION_CLIENT"))
                            .map((k) => (
                              <div
                                key={k.key}
                                className="flex items-center gap-2 text-[10px]"
                              >
                                {k.configured ? (
                                  <IconCheck
                                    size={10}
                                    className="text-emerald-500"
                                  />
                                ) : (
                                  <IconCircle
                                    size={10}
                                    className="text-muted-foreground"
                                  />
                                )}
                                <span className="text-muted-foreground">
                                  {k.label}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}

                      {step.showConnect && (
                        <Button
                          size="sm"
                          onClick={handleConnect}
                          disabled={!oauthConfigured}
                          className="w-full"
                        >
                          {oauthConfigured ? (
                            t("sidebar.notionConnectWorkspace")
                          ) : (
                            <>
                              <IconLoader2
                                size={12}
                                className="me-1 animate-spin"
                              />
                              {t("sidebar.completeStepsAboveFirst")}
                            </>
                          )}
                        </Button>
                      )}

                      {i < OAUTH_STEPS.length - 1 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs"
                          onClick={() => setCurrentStep(i + 1)}
                        >
                          {t("sidebar.nextStep")}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // ─── Connected state ────────────────────────────────────────────────────

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "flex size-8 items-center justify-center rounded-md hover:bg-accent",
                isConnected
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <NotionIcon className="h-4 w-4" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {isConnected
            ? t("sidebar.notionConnectedTooltip", {
                name: connection?.workspaceName ?? t("sidebar.connected"),
              })
            : t("sidebar.notionConnect")}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        className="w-64 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {isConnected ? (
          <>
            <div className="px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <NotionIcon className="h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {connection?.workspaceName ?? "Notion"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {t("sidebar.connectedViaOAuth")}
                  </p>
                </div>
              </div>
            </div>
            <div className="p-2 space-y-0.5">
              <button
                onClick={() => {
                  refetch();
                  toast.success(t("sidebar.synced"));
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-md"
              >
                <IconRefresh size={12} />
                {t("sidebar.refreshConnection")}
              </button>
              <button
                onClick={() => {
                  handleDisconnect();
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-md"
              >
                <IconPlugOff size={12} />
                {t("sidebar.disconnectWorkspace")}
              </button>
            </div>
          </>
        ) : (
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <NotionIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-sm font-medium">
                {t("sidebar.notionConnect")}
              </p>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {t("sidebar.notionSyncDocumentsDescription")}
            </p>
            <Button
              size="sm"
              className="w-full"
              onClick={() => {
                if (needsCredentials) {
                  setShowWizard(true);
                } else {
                  handleConnect();
                }
              }}
            >
              {needsCredentials
                ? t("editor.toolbar.setUpNotion")
                : t("sidebar.connectWorkspace")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
