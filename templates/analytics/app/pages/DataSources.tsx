import {
  appApiPath,
  agentNativePath,
  oauthRedirectUri,
  useActionMutation,
  useActionQuery,
  useSendToAgentChat,
  PromptComposer,
  useT,
} from "@agent-native/core/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-native/toolkit/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconExternalLink,
  IconLoader2,
  IconCircle,
  IconAlertCircle,
  IconUpload,
  IconPencil,
  IconTrash,
  IconSearch,
  IconPlus,
  IconKey,
  IconCopy,
  IconDotsVertical,
  IconBrandGithub,
} from "@tabler/icons-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { getIdToken } from "@/lib/auth";
import {
  getOptionalCredentialKeys,
  getSharedConnectionStatus,
  isSourceReady,
  isSourceLocallyConfigured,
  credentialRowsFromStatus,
  type DataSourceStatusResponse,
  type EnvKeyStatus,
  type SharedConnectionStatus,
} from "@/lib/data-source-status";
import {
  dataSources,
  categoryLabels,
  categoryOrder,
  type DataSource,
  type WalkthroughStep,
} from "@/lib/data-sources";

interface AnalyticsPublicKeyRow {
  id: string;
  name: string;
  publicKeyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  orgId: string | null;
}

interface GitHubOAuthStatus {
  configured: boolean;
  connected: boolean;
  valid?: boolean;
  viewer?: {
    login: string;
    name?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
    htmlUrl?: string | null;
  };
  error?: string;
}

const firstPartyAnalyticsEndpoint =
  (import.meta.env as Record<string, string | undefined>)
    .VITE_AGENT_NATIVE_ANALYTICS_ENDPOINT ||
  "https://analytics.agent-native.com/track";

async function saveEnvVars(
  vars: Array<{ key: string; value: string }>,
): Promise<void> {
  const token = await getIdToken();
  const res = await fetch(appApiPath("/api/credentials"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ vars }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to save");
  }
}

async function testConnection(
  source: string,
): Promise<{ ok: boolean; error?: string }> {
  const token = await getIdToken();
  const res = await fetch(appApiPath("/api/test-connection"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ source }),
  });
  return res.json();
}

async function fetchGitHubOAuthStatus(): Promise<GitHubOAuthStatus> {
  const res = await fetch(
    agentNativePath("/_agent-native/oauth/github/status"),
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to load GitHub status");
  }
  return res.json();
}

function StepItem({
  step,
  index,
  isComplete,
  isActive,
  isSaved,
  inputValues,
  onInputChange,
}: {
  step: WalkthroughStep;
  index: number;
  isComplete: boolean;
  isActive: boolean;
  isSaved: boolean;
  inputValues: Record<string, string>;
  onInputChange: (key: string, value: string) => void;
}) {
  const t = useT();
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !step.inputKey) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onInputChange(step.inputKey!, reader.result);
      }
    };
    reader.readAsText(file);
    // Reset so the same file can be re-selected
    e.target.value = "";
  };

  return (
    <div className="flex gap-3 py-3">
      <div className="flex flex-col items-center">
        <div
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
            isComplete
              ? "bg-emerald-500/20 text-emerald-500"
              : isActive
                ? "bg-primary/20 text-primary"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {isComplete ? <IconCheck className="h-3.5 w-3.5" /> : index + 1}
        </div>
      </div>
      <div className="flex-1 space-y-2">
        <p
          className={`text-sm font-medium ${isComplete ? "text-muted-foreground" : ""}`}
        >
          {step.title}
        </p>
        <p className="text-xs text-muted-foreground whitespace-pre-line">
          {step.description}
        </p>
        {step.url && (
          <a
            href={step.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            {step.linkText || t("dataSources.open")}{" "}
            <IconExternalLink className="h-3 w-3" />
          </a>
        )}
        {step.inputKey && (
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">
                {step.inputLabel || step.inputKey}
              </label>
              {step.inputAcceptFile && (
                <label className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 cursor-pointer">
                  <IconUpload className="h-3 w-3" />
                  {t("dataSources.uploadFile")}
                  <input
                    type="file"
                    accept={step.inputAcceptFile}
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              )}
            </div>
            {step.inputType === "textarea" ? (
              <textarea
                value={inputValues[step.inputKey] || ""}
                onChange={(e) => onInputChange(step.inputKey!, e.target.value)}
                placeholder={isSaved ? "••••••••" : step.inputPlaceholder}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 min-h-[80px] resize-y font-mono"
              />
            ) : (
              <input
                type={step.inputType || "text"}
                value={inputValues[step.inputKey] || ""}
                onChange={(e) => onInputChange(step.inputKey!, e.target.value)}
                placeholder={isSaved ? "••••••••" : step.inputPlaceholder}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
              />
            )}
            {isSaved && !inputValues[step.inputKey] && (
              <p className="text-xs text-muted-foreground">
                {t("dataSources.savedValueHint")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

async function deleteCredentials(keys: string[]): Promise<void> {
  const token = await getIdToken();
  const res = await fetch(appApiPath("/api/credentials"), {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ keys }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to delete");
  }
}

async function disconnectDataSource(source: DataSource): Promise<void> {
  if (source.id === "github") {
    const res = await fetch(
      agentNativePath("/_agent-native/oauth/github/disconnect"),
      { method: "POST" },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to disconnect GitHub");
    }
    return;
  }
  await deleteCredentials(source.envKeys);
}

function GitHubOAuthView({
  connected,
  onSaved,
}: {
  connected: boolean;
  onSaved: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: status, isLoading } = useQuery({
    queryKey: ["github-oauth-status"],
    queryFn: fetchGitHubOAuthStatus,
    staleTime: 30_000,
    retry: false,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["github-oauth-status"] });
    onSaved();
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "agent-native:github-connected") refresh();
    };

    window.addEventListener("message", onMessage);

    let channel: BroadcastChannel | null = null;
    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel("agent-native-github-oauth");
      channel.onmessage = (event) => {
        if (event.data?.type === "agent-native:github-connected") refresh();
      };
    }

    return () => {
      window.removeEventListener("message", onMessage);
      channel?.close();
    };
  }, [queryClient, onSaved]);

  const connectMutation = useMutation({
    mutationFn: async () => {
      const redirectUri = oauthRedirectUri(
        "/_agent-native/oauth/github/callback",
      );
      const authPath = agentNativePath(
        `/_agent-native/oauth/github/auth-url?redirect_uri=${encodeURIComponent(redirectUri)}&redirect=1`,
      );
      const popup = window.open(
        authPath,
        "_blank",
        "popup,width=560,height=760",
      );
      if (!popup) {
        window.location.assign(authPath);
        return { opened: "same-tab" as const };
      }
      return { opened: "popup" as const };
    },
    onSuccess: () => {
      const startedAt = Date.now();
      const pollId = window.setInterval(() => {
        refresh();
        if (Date.now() - startedAt > 120_000) {
          window.clearInterval(pollId);
        }
      }, 2_000);
    },
  });

  const oauthAvailable = status?.configured ?? false;
  const oauthConnected = !!status?.connected && status.valid !== false;
  const viewerLabel =
    status?.viewer?.name || status?.viewer?.login || status?.viewer?.email;

  return (
    <div className="space-y-3 rounded-md border border-border/50 bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
            <IconBrandGithub className="h-4 w-4" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium text-foreground">
              {t("dataSources.githubOAuth")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("dataSources.githubOAuthDescription")}
            </p>
          </div>
        </div>
        {isLoading ? (
          <Skeleton className="h-8 w-24 shrink-0 rounded-md" />
        ) : oauthAvailable ? (
          <Button
            size="sm"
            variant={oauthConnected ? "outline" : "default"}
            onClick={() => connectMutation.mutate()}
            disabled={connectMutation.isPending}
            className="shrink-0 text-xs"
          >
            {connectMutation.isPending ? (
              <>
                <IconLoader2 className="mr-1.5 h-3 w-3 animate-spin" />
                {t("dataSources.opening")}
              </>
            ) : oauthConnected || connected ? (
              t("dataSources.reconnect")
            ) : (
              t("dataSources.connect")
            )}
          </Button>
        ) : null}
      </div>

      {oauthAvailable ? (
        oauthConnected ? (
          <div className="flex items-center gap-2 text-xs text-emerald-500">
            <IconCheck className="h-3.5 w-3.5" />
            {viewerLabel
              ? t("dataSources.connectedAs", { viewer: viewerLabel })
              : t("dataSources.githubConnected")}
          </div>
        ) : status?.connected && status.valid === false ? (
          <div className="flex items-center gap-2 text-xs text-amber-500">
            <IconAlertCircle className="h-3.5 w-3.5" />
            {t("dataSources.githubReconnectNeeded")}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("dataSources.githubOAuthRequest")}
          </p>
        )
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("dataSources.githubOAuthUnavailable")}
        </p>
      )}

      {connectMutation.isError && (
        <div className="flex items-center gap-2 text-xs text-rose-400">
          <IconAlertCircle className="h-3.5 w-3.5" />
          {(connectMutation.error as Error).message}
        </div>
      )}
    </div>
  );
}

function SharedConnectionBadge({ status }: { status: SharedConnectionStatus }) {
  const tone =
    status.kind === "ready"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : status.kind === "needs_grant"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : status.kind === "local_credentials"
          ? "border-border/60 bg-muted text-muted-foreground"
          : "border-border/60 bg-background text-muted-foreground";

  return (
    <Badge variant="outline" className={tone}>
      {status.label}
    </Badge>
  );
}

function SharedConnectionStatusRow({
  status,
}: {
  status: SharedConnectionStatus;
}) {
  const t = useT();
  const message =
    status.kind === "ready"
      ? t("dataSources.sharedReady")
      : status.kind === "needs_grant"
        ? t("dataSources.sharedNeedsGrant")
        : status.kind === "local_credentials"
          ? t("dataSources.sharedLocalCredentials")
          : t("dataSources.sharedFallback");

  return (
    <div className="mb-4 flex items-start justify-between gap-3 rounded-md border border-border/50 bg-muted/20 p-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium text-foreground">
            {t("dataSources.sharedIntegration")}
          </p>
          <SharedConnectionBadge status={status} />
        </div>
        <p className="text-xs text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function WorkspaceReadyView({
  source,
  onSaved,
  onAddLocalCredentials,
}: {
  source: DataSource;
  onSaved: () => void;
  onAddLocalCredentials: () => void;
}) {
  const t = useT();
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    error?: string;
  } | null>(null);

  const testMutation = useMutation({
    mutationFn: () => testConnection(source.id),
    onSuccess: (result) => {
      setTestResult(result);
      onSaved();
    },
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {t("dataSources.workspaceReadyDescription")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setTestResult(null);
            testMutation.mutate();
          }}
          disabled={testMutation.isPending}
          className="text-xs"
        >
          {testMutation.isPending ? (
            <IconLoader2 className="mr-1.5 h-3 w-3 animate-spin" />
          ) : (
            <IconCheck className="mr-1.5 h-3 w-3" />
          )}
          {testMutation.isPending
            ? t("dataSources.testing")
            : t("dataSources.testConnection")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onAddLocalCredentials}
          className="text-xs"
        >
          {t("dataSources.addLocalCredentials")}
        </Button>
        {source.docsUrl && (
          <a
            href={source.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          >
            {t("dataSources.docs")} <IconExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {testResult && (
        <div
          className={`flex items-center gap-2 text-xs ${testResult.ok ? "text-emerald-500" : "text-rose-400"}`}
        >
          {testResult.ok ? (
            <>
              <IconCheck className="h-3.5 w-3.5" />
              {t("dataSources.connectionSuccessful")}
            </>
          ) : (
            <>
              <IconAlertCircle className="h-3.5 w-3.5" />
              {testResult.error || t("dataSources.connectionFailed")}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectedView({
  source,
  onSaved,
  envStatus,
}: {
  source: DataSource;
  onSaved: () => void;
  envStatus: EnvKeyStatus[];
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [pendingClears, setPendingClears] = useState<Set<string>>(new Set());
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    error?: string;
  } | null>(null);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const vars: Array<{ key: string; value: string }> = [];
      for (const [key, value] of Object.entries(inputValues)) {
        const trimmed = value.trim();
        if (trimmed) vars.push({ key, value: trimmed });
      }
      for (const key of pendingClears) {
        if (!inputValues[key]?.trim()) vars.push({ key, value: "" });
      }
      if (vars.length === 0) return;
      await saveEnvVars(vars);
    },
    onSuccess: () => {
      setInputValues({});
      setPendingClears(new Set());
      setEditing(false);
      onSaved();
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => disconnectDataSource(source),
    onSuccess: () => {
      setDisconnectConfirmOpen(false);
      if (source.id === "github") {
        queryClient.invalidateQueries({ queryKey: ["github-oauth-status"] });
      }
      onSaved();
    },
  });

  const testMutation = useMutation({
    mutationFn: () => testConnection(source.id),
    onSuccess: (result) => {
      setTestResult(result);
      // Refresh envStatus so the per-key "Configured"/"Missing" labels
      // reflect reality after a test that revealed missing credentials.
      onSaved();
    },
  });

  const hasInputValues =
    Object.values(inputValues).some((v) => v.trim()) || pendingClears.size > 0;

  // Get credential labels from walkthrough steps
  const keyLabels: Record<string, string> = {};
  for (const step of source.walkthroughSteps) {
    if (step.inputKey) {
      keyLabels[step.inputKey] = step.inputLabel || step.inputKey;
    }
  }
  const sharedCredentialKeys = source.envKeys.filter((key) =>
    dataSources.some(
      (other) => other.id !== source.id && other.envKeys.includes(key),
    ),
  );
  const sharedSourceNames = Array.from(
    new Set(
      dataSources
        .filter(
          (other) =>
            other.id !== source.id &&
            other.envKeys.some((key) => source.envKeys.includes(key)),
        )
        .map((other) => other.name),
    ),
  );
  const optionalKeys = getOptionalCredentialKeys(source);
  const isAnyCredentialMode = source.credentialRequirementMode === "any";
  const configuredCredentialKeys = new Set(
    envStatus.filter((s) => s.configured).map((s) => s.key),
  );
  const hasAlternativeCredential =
    isAnyCredentialMode &&
    source.envKeys.some((key) => configuredCredentialKeys.has(key));

  const handleDisconnect = () => {
    if (sharedCredentialKeys.length > 0) {
      setDisconnectConfirmOpen(true);
      return;
    }
    disconnectMutation.mutate();
  };

  if (editing) {
    return (
      <div className="space-y-3 py-3">
        {source.walkthroughSteps
          .filter((step) => step.inputKey)
          .map((step) => {
            const stepKey = step.inputKey!;
            const isOptional = optionalKeys.has(stepKey);
            const isConfigured = !!envStatus.find((s) => s.key === stepKey)
              ?.configured;
            const isPendingClear = pendingClears.has(stepKey);
            const hasTyped = !!inputValues[stepKey]?.trim();
            return (
              <div key={stepKey} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">
                    {step.inputLabel || stepKey}
                  </label>
                  <div className="flex items-center gap-3">
                    {isOptional && isConfigured && !isPendingClear && (
                      <button
                        type="button"
                        onClick={() => {
                          setPendingClears((prev) => {
                            const next = new Set(prev);
                            next.add(stepKey);
                            return next;
                          });
                          setInputValues((prev) => {
                            const next = { ...prev };
                            delete next[stepKey];
                            return next;
                          });
                        }}
                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-rose-400 cursor-pointer"
                      >
                        <IconTrash className="h-3 w-3" />
                        {t("dataSources.clearSavedValue")}
                      </button>
                    )}
                    {step.inputAcceptFile && !isPendingClear && (
                      <label className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 cursor-pointer">
                        <IconUpload className="h-3 w-3" />
                        {t("dataSources.uploadFile")}
                        <input
                          type="file"
                          accept={step.inputAcceptFile}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = () => {
                              if (typeof reader.result === "string") {
                                setInputValues((prev) => ({
                                  ...prev,
                                  [stepKey]: reader.result as string,
                                }));
                              }
                            };
                            reader.readAsText(file);
                            e.target.value = "";
                          }}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>
                </div>
                {step.inputType === "textarea" ? (
                  <textarea
                    value={inputValues[stepKey] || ""}
                    disabled={isPendingClear}
                    onChange={(e) =>
                      setInputValues((prev) => ({
                        ...prev,
                        [stepKey]: e.target.value,
                      }))
                    }
                    placeholder={isPendingClear ? "" : "••••••••"}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 min-h-[80px] resize-y font-mono disabled:opacity-50"
                  />
                ) : (
                  <input
                    type={step.inputType || "text"}
                    value={inputValues[stepKey] || ""}
                    disabled={isPendingClear}
                    onChange={(e) =>
                      setInputValues((prev) => ({
                        ...prev,
                        [stepKey]: e.target.value,
                      }))
                    }
                    placeholder={isPendingClear ? "" : "••••••••"}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 disabled:opacity-50"
                  />
                )}
                {isPendingClear ? (
                  <div className="flex items-center justify-between gap-2 text-xs text-amber-500">
                    <span>{t("dataSources.willClearOnSave")}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingClears((prev) => {
                          const next = new Set(prev);
                          next.delete(stepKey);
                          return next;
                        });
                      }}
                      className="text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      {t("dataSources.undo")}
                    </button>
                  </div>
                ) : (
                  isConfigured &&
                  !hasTyped && (
                    <p className="text-xs text-muted-foreground">
                      {t("dataSources.savedValueHint")}
                    </p>
                  )
                )}
              </div>
            );
          })}
        <div className="flex items-center gap-2 pt-2">
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !hasInputValues}
            className="text-xs"
          >
            {saveMutation.isPending ? (
              <>
                <IconLoader2 className="h-3 w-3 animate-spin mr-1.5" />
                {t("dataSources.saving")}
              </>
            ) : (
              t("dataSources.saveChanges")
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setInputValues({});
              setPendingClears(new Set());
            }}
            className="text-xs"
          >
            {t("sidebar.cancel")}
          </Button>
        </div>
        {saveMutation.isError && (
          <div className="flex items-center gap-2 text-xs text-rose-400">
            <IconAlertCircle className="h-3.5 w-3.5" />
            {(saveMutation.error as Error).message}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            {source.envKeys.map((key) => {
              const configured = configuredCredentialKeys.has(key);
              const optional = optionalKeys.has(key);
              return (
                <div
                  key={key}
                  className="flex items-center justify-between gap-4 text-xs"
                >
                  <span className="text-muted-foreground">
                    {keyLabels[key] || key}
                  </span>
                  {configured ? (
                    <span className="flex items-center gap-1 whitespace-nowrap text-emerald-500">
                      <IconCheck className="h-3 w-3" />
                      {t("dataSources.configured")}
                    </span>
                  ) : optional ? (
                    <span className="flex items-center gap-1 whitespace-nowrap text-muted-foreground">
                      <IconCircle className="h-3 w-3" />
                      {t("dataSources.optional")}
                    </span>
                  ) : hasAlternativeCredential ? (
                    <span className="flex items-center gap-1 whitespace-nowrap text-muted-foreground">
                      <IconCircle className="h-3 w-3" />
                      Alternative
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 whitespace-nowrap text-rose-400">
                      <IconAlertCircle className="h-3 w-3" />
                      {t("dataSources.missing")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="-mr-1 -mt-1 h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={t("dataSources.sourceActions", {
                  name: source.name,
                })}
              >
                <IconDotsVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onSelect={() => {
                  setTestResult(null);
                  testMutation.mutate();
                }}
                disabled={testMutation.isPending}
              >
                {testMutation.isPending ? (
                  <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <IconCheck className="mr-2 h-4 w-4" />
                )}
                {testMutation.isPending
                  ? t("dataSources.testing")
                  : t("dataSources.testConnection")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <IconPencil className="mr-2 h-4 w-4" />
                {t("dataSources.editCredentials")}
              </DropdownMenuItem>
              {source.docsUrl && (
                <DropdownMenuItem asChild>
                  <a
                    href={source.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <IconExternalLink className="mr-2 h-4 w-4" />
                    {t("dataSources.openDocs")}
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={handleDisconnect}
                disabled={disconnectMutation.isPending}
                className="text-destructive focus:text-destructive"
              >
                {disconnectMutation.isPending ? (
                  <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <IconTrash className="mr-2 h-4 w-4" />
                )}
                {disconnectMutation.isPending
                  ? t("dataSources.disconnecting")
                  : t("dataSources.disconnect")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {testResult && (
          <div
            className={`flex items-center gap-2 text-xs ${testResult.ok ? "text-emerald-500" : "text-rose-400"}`}
          >
            {testResult.ok ? (
              <>
                <IconCheck className="h-3.5 w-3.5" />
                {t("dataSources.connectionSuccessful")}
              </>
            ) : (
              <>
                <IconAlertCircle className="h-3.5 w-3.5" />
                {testResult.error || t("dataSources.connectionFailed")}
              </>
            )}
          </div>
        )}
      </div>
      <AlertDialog
        open={disconnectConfirmOpen}
        onOpenChange={setDisconnectConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("dataSources.disconnectTitle", { name: source.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("dataSources.disconnectDescription", {
                sources: sharedSourceNames.join(", "),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
            {t("dataSources.sharedCredentials", {
              credentials: sharedCredentialKeys
                .map((key) => keyLabels[key] || key)
                .join(", "),
            })}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {disconnectMutation.isPending
                ? t("dataSources.disconnecting")
                : t("dataSources.disconnect")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DataSourceCard({
  source,
  locallyConfigured,
  ready,
  sharedConnectionStatus,
  envStatus,
  isStatusLoading,
  onSaved,
}: {
  source: DataSource;
  locallyConfigured: boolean;
  ready: boolean;
  sharedConnectionStatus: SharedConnectionStatus | null;
  envStatus: EnvKeyStatus[];
  isStatusLoading: boolean;
  onSaved: () => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [showLocalCredentials, setShowLocalCredentials] = useState(false);
  const totalSteps = source.walkthroughSteps.length;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const vars = Object.entries(inputValues)
        .filter(([, v]) => v.trim())
        .map(([key, value]) => ({ key, value: value.trim() }));
      if (vars.length === 0) return;
      await saveEnvVars(vars);
    },
    onSuccess: () => {
      setInputValues({});
      onSaved();
    },
  });

  const Icon = source.icon;
  const hasInputValues = Object.values(inputValues).some((v) => v.trim());
  const readyViaWorkspace = sharedConnectionStatus?.kind === "ready";
  const showCredentialSetup =
    !locallyConfigured && (!readyViaWorkspace || showLocalCredentials);

  return (
    <Card className="data-source-card bg-card border-border/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full rounded-t-lg text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
      >
        <CardHeader className="p-5">
          <div className="flex items-center justify-between gap-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-sm font-medium">
                  {source.name}
                </CardTitle>
                <CardDescription className="mt-0.5 line-clamp-2 text-xs">
                  {source.description}
                </CardDescription>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isStatusLoading ? (
                <Skeleton className="h-4 w-20 rounded-full" />
              ) : ready ? (
                <span className="flex items-center gap-1.5 text-xs text-emerald-500 font-medium whitespace-nowrap">
                  <IconCheck className="h-3.5 w-3.5" />
                  {readyViaWorkspace && !locallyConfigured
                    ? t("dataSources.ready")
                    : t("dataSources.configured")}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
                  <IconCircle className="h-3 w-3" />
                  {t("dataSources.notConfigured")}
                </span>
              )}
              {!isStatusLoading && sharedConnectionStatus && (
                <span className="data-source-shared-badge">
                  <SharedConnectionBadge status={sharedConnectionStatus} />
                </span>
              )}
              {expanded ? (
                <IconChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <IconChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CardHeader>
      </button>

      {expanded && (
        <CardContent className="border-t border-border/50 px-5 py-4">
          {source.id === "github" && (
            <div className="mb-4">
              <GitHubOAuthView
                connected={locallyConfigured}
                onSaved={onSaved}
              />
            </div>
          )}
          {sharedConnectionStatus && (
            <SharedConnectionStatusRow status={sharedConnectionStatus} />
          )}
          {locallyConfigured ? (
            <ConnectedView
              source={source}
              onSaved={onSaved}
              envStatus={envStatus}
            />
          ) : readyViaWorkspace && !showCredentialSetup ? (
            <WorkspaceReadyView
              source={source}
              onSaved={onSaved}
              onAddLocalCredentials={() => setShowLocalCredentials(true)}
            />
          ) : (
            <>
              {/* Step progress */}
              <div className="flex items-center gap-1.5 pb-3">
                {source.walkthroughSteps.map((_, i) => (
                  <button
                    key={i}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCurrentStep(i);
                    }}
                    className={`h-1.5 flex-1 rounded-full transition-colors ${
                      i < currentStep
                        ? "bg-emerald-500/60"
                        : i === currentStep
                          ? "bg-primary"
                          : "bg-muted"
                    }`}
                  />
                ))}
              </div>

              {/* Current step */}
              {(() => {
                const step = source.walkthroughSteps[currentStep];
                const isSaved = !!(
                  step.inputKey &&
                  envStatus.find((s) => s.key === step.inputKey)?.configured
                );
                return (
                  <StepItem
                    key={currentStep}
                    step={step}
                    index={currentStep}
                    isComplete={false}
                    isActive={true}
                    isSaved={isSaved}
                    inputValues={inputValues}
                    onInputChange={(key, value) =>
                      setInputValues((prev) => ({ ...prev, [key]: value }))
                    }
                  />
                );
              })()}

              {/* Step navigation. Continue is gated on completing the
                  current step's input — otherwise the progress bar advances
                  while the user hasn't actually done anything, which feels
                  misleading. Steps with no input (just a link to a console)
                  or marked optional always allow Continue. */}
              {(() => {
                const step = source.walkthroughSteps[currentStep];
                const stepKey = step.inputKey;
                const stepFilled = stepKey
                  ? !!inputValues[stepKey]?.trim() ||
                    !!envStatus.find((s) => s.key === stepKey)?.configured
                  : true;
                const canAdvance = !stepKey || step.optional || stepFilled;
                return (
                  <div className="flex items-center gap-2 pb-4 pt-1">
                    {currentStep > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCurrentStep((s) => s - 1);
                        }}
                        className="text-xs"
                      >
                        {t("dataSources.back")}
                      </Button>
                    )}
                    {currentStep < totalSteps - 1 && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canAdvance}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCurrentStep((s) => s + 1);
                        }}
                        className="text-xs"
                      >
                        {t("dataSources.continue")}
                      </Button>
                    )}
                  </div>
                );
              })()}

              <div className="flex items-center gap-2 border-t border-border/30 pt-3">
                {hasInputValues && (
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      saveMutation.mutate();
                    }}
                    disabled={saveMutation.isPending}
                    className="text-xs"
                  >
                    {saveMutation.isPending ? (
                      <>
                        <IconLoader2 className="h-3 w-3 animate-spin mr-1.5" />
                        {t("dataSources.saving")}
                      </>
                    ) : (
                      t("dataSources.saveCredentials")
                    )}
                  </Button>
                )}
                {source.docsUrl && (
                  <a
                    href={source.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 ml-auto"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t("dataSources.docs")}{" "}
                    <IconExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              {saveMutation.isError && (
                <div className="mt-3 flex items-center gap-2 text-xs text-rose-400">
                  <IconAlertCircle className="h-3.5 w-3.5" />
                  {(saveMutation.error as Error).message}
                </div>
              )}
              {saveMutation.isSuccess && (
                <div className="mt-3 flex items-center gap-2 text-xs text-emerald-500">
                  <IconCheck className="h-3.5 w-3.5" />
                  {t("dataSources.credentialsSaved")}
                </div>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function AddDataSourceCTA() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { send, isGenerating } = useSendToAgentChat();

  function handleSubmit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isGenerating) return;
    send({
      message: trimmed,
      context:
        "The user wants to add a new data source integration to the analytics app. " +
        "Help them add the integration by: creating a new entry in app/lib/data-sources.ts with the source metadata, " +
        "any required server-side API client code, and updating the relevant skill documentation. " +
        "Ask clarifying questions if needed about which service they want to connect.",
      submit: true,
    });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="data-source-add-trigger gap-1.5"
          disabled={isGenerating}
        >
          {isGenerating ? (
            <IconLoader2 className="h-4 w-4 animate-spin" />
          ) : (
            <IconPlus className="h-4 w-4" />
          )}
          {isGenerating
            ? t("dataSources.adding")
            : t("dataSources.addDataSource")}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[calc(100vw-2rem)] p-3 sm:w-[420px]"
        align="end"
      >
        <p className="px-1 pb-1 text-sm font-semibold text-foreground">
          {t("dataSources.addDataSourceTitle")}
        </p>
        <p className="px-1 pb-3 text-xs text-muted-foreground">
          {t("dataSources.addDataSourceDescription")}
        </p>
        <PromptComposer
          autoFocus
          disabled={isGenerating}
          placeholder={t("dataSources.addDataSourcePlaceholder")}
          draftScope="analytics:add-data-source"
          onSubmit={handleSubmit}
        />
      </PopoverContent>
    </Popover>
  );
}

function FirstPartyAnalyticsCard() {
  const t = useT();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(() => t("dataSources.defaultKeyName"));
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useActionQuery(
    "list-analytics-public-keys",
    undefined,
    { staleTime: 10_000 },
  );
  const keys = ((data as AnalyticsPublicKeyRow[] | undefined) ?? []).filter(
    (key) => !key.revokedAt,
  );
  const connected = keys.length > 0;

  const createKey = useActionMutation("create-analytics-public-key", {
    onSuccess: (result: any) => {
      setCreatedKey(result.publicKey);
      setCopied(false);
      queryClient.invalidateQueries({
        queryKey: ["action", "list-analytics-public-keys"],
      });
    },
  });

  const revokeKey = useActionMutation("revoke-analytics-public-key", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["action", "list-analytics-public-keys"],
      });
    },
  });

  const copyCreatedKey = async () => {
    if (!createdKey) return;
    await navigator.clipboard?.writeText(createdKey);
    setCopied(true);
  };

  return (
    <Card className="data-source-card bg-card border-border/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full rounded-t-lg text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
      >
        <CardHeader className="p-5">
          <div className="flex items-center justify-between gap-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <IconKey className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-sm font-medium">
                  {t("dataSources.firstPartyAnalytics")}
                </CardTitle>
                <CardDescription className="mt-0.5 line-clamp-2 text-xs">
                  {t("dataSources.firstPartyDescription")}
                </CardDescription>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isLoading ? (
                <Skeleton className="h-4 w-20 rounded-full" />
              ) : connected ? (
                <span className="flex items-center gap-1.5 text-xs text-emerald-500 font-medium whitespace-nowrap">
                  <IconCheck className="h-3.5 w-3.5" />
                  {t("dataSources.configured")}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
                  <IconCircle className="h-3 w-3" />
                  {t("dataSources.notConfigured")}
                </span>
              )}
              {expanded ? (
                <IconChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <IconChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CardHeader>
      </button>

      {expanded && (
        <CardContent className="border-t border-border/50 px-5 py-4">
          <div className="space-y-4">
            <div className="grid gap-2 rounded-md border border-border/50 bg-muted/20 p-3 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">
                  {t("dataSources.endpoint")}
                </span>
                <code className="truncate font-mono">
                  {firstPartyAnalyticsEndpoint}
                </code>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">
                  {t("dataSources.serverEnv")}
                </span>
                <code className="truncate font-mono">
                  AGENT_NATIVE_ANALYTICS_PUBLIC_KEY
                </code>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">
                  {t("dataSources.browserEnv")}
                </span>
                <code className="truncate font-mono">
                  VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY
                </code>
              </div>
            </div>

            <div className="data-source-inline-form">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
                placeholder={t("dataSources.keyNamePlaceholder")}
              />
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  createKey.mutate({ name });
                }}
                disabled={createKey.isPending}
                className="data-source-inline-form-button text-xs"
              >
                {createKey.isPending ? (
                  <>
                    <IconLoader2 className="h-3 w-3 animate-spin mr-1.5" />
                    {t("dataSources.generating")}
                  </>
                ) : (
                  <>
                    <IconPlus className="h-3 w-3 mr-1.5" />
                    {t("dataSources.generateKey")}
                  </>
                )}
              </Button>
            </div>

            {createdKey && (
              <div className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3">
                <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  {t("dataSources.newKeyGenerated")}
                </p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={createdKey}
                    className="flex min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyCreatedKey();
                    }}
                    className="text-xs"
                  >
                    <IconCopy className="h-3 w-3 mr-1.5" />
                    {copied ? t("dataSources.copied") : t("dataSources.copy")}
                  </Button>
                </div>
              </div>
            )}

            {keys.length > 0 && (
              <div className="space-y-2 border-t border-border/30 pt-3">
                {keys.map((key) => (
                  <div
                    key={key.id}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{key.name}</div>
                      <div className="text-muted-foreground font-mono">
                        {key.publicKeyPrefix}...
                        {key.lastUsedAt
                          ? ` ${t("dataSources.lastUsed", {
                              date: new Date(
                                key.lastUsedAt,
                              ).toLocaleDateString(),
                            })}`
                          : ` ${t("dataSources.neverUsed")}`}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                          aria-label={t("dataSources.keyActions", {
                            name: key.name,
                          })}
                        >
                          <IconDotsVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem
                          onSelect={() => revokeKey.mutate({ id: key.id })}
                          disabled={revokeKey.isPending}
                          className="text-destructive focus:text-destructive"
                        >
                          {revokeKey.isPending ? (
                            <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <IconTrash className="mr-2 h-4 w-4" />
                          )}
                          {revokeKey.isPending
                            ? t("dataSources.revoking")
                            : t("dataSources.revoke")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default function DataSources() {
  const t = useT();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: rawStatusData, isLoading: isStatusLoading } = useActionQuery(
    "data-source-status",
    undefined,
    {
      staleTime: 10_000,
    },
  );
  const statusData = rawStatusData as DataSourceStatusResponse | undefined;
  const envStatus = credentialRowsFromStatus(statusData);

  const configuredCount = dataSources.filter((s) =>
    isSourceReady(s, statusData, envStatus),
  ).length;

  const handleSaved = () => {
    queryClient.invalidateQueries({
      queryKey: ["action", "data-source-status"],
    });
  };

  const searchLower = search.toLowerCase();
  const firstPartyAnalyticsSearchText = [
    t("dataSources.firstPartyAnalytics"),
    t("dataSources.firstPartyDescription"),
    "first-party analytics tracking observability llm ai generation $ai_generation posthog agent native analytics AGENT_NATIVE_ANALYTICS_PUBLIC_KEY VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY",
  ]
    .join(" ")
    .toLowerCase();
  const firstPartyAnalyticsMatchesSearch =
    search.length > 0 && firstPartyAnalyticsSearchText.includes(searchLower);
  const filteredSources = search
    ? dataSources.filter(
        (s) =>
          s.name.toLowerCase().includes(searchLower) ||
          s.description.toLowerCase().includes(searchLower),
      )
    : null;

  return (
    <div className="data-sources-layout mx-auto max-w-5xl space-y-8">
      <p className="text-sm text-muted-foreground">
        {t("dataSources.intro")}{" "}
        {!isStatusLoading &&
          (configuredCount > 0 ? (
            <span className="text-emerald-500 font-medium">
              {t("dataSources.configuredCount", { count: configuredCount })}
            </span>
          ) : (
            <span className="text-amber-500 font-medium">
              {t("dataSources.configuredCount", { count: 0 })}
            </span>
          ))}
      </p>

      {/* Search bar + Add Data Source */}
      <div className="data-sources-toolbar">
        <div className="relative min-w-0 flex-1">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("dataSources.searchPlaceholder")}
            className="flex w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
          />
        </div>
        <AddDataSourceCTA />
      </div>

      {/* Filtered results */}
      {filteredSources !== null ? (
        filteredSources.length > 0 || firstPartyAnalyticsMatchesSearch ? (
          <div className="data-sources-grid">
            {firstPartyAnalyticsMatchesSearch && <FirstPartyAnalyticsCard />}
            {filteredSources.map((source) => (
              <DataSourceCard
                key={source.id}
                source={source}
                locallyConfigured={isSourceLocallyConfigured(
                  source,
                  statusData,
                  envStatus,
                )}
                ready={isSourceReady(source, statusData, envStatus)}
                sharedConnectionStatus={getSharedConnectionStatus(
                  source,
                  statusData,
                  envStatus,
                )}
                envStatus={envStatus}
                isStatusLoading={isStatusLoading}
                onSaved={handleSaved}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4">
            {t("dataSources.noMatch", { search })}
          </p>
        )
      ) : (
        categoryOrder.map((category) => {
          const sources = dataSources.filter((s) => s.category === category);
          if (sources.length === 0) return null;
          return (
            <div key={category} className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {categoryLabels[category]}
              </h3>
              <div className="data-sources-grid">
                {category === "analytics" && <FirstPartyAnalyticsCard />}
                {sources.map((source) => (
                  <DataSourceCard
                    key={source.id}
                    source={source}
                    locallyConfigured={isSourceLocallyConfigured(
                      source,
                      statusData,
                      envStatus,
                    )}
                    ready={isSourceReady(source, statusData, envStatus)}
                    sharedConnectionStatus={getSharedConnectionStatus(
                      source,
                      statusData,
                      envStatus,
                    )}
                    envStatus={envStatus}
                    isStatusLoading={isStatusLoading}
                    onSaved={handleSaved}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
