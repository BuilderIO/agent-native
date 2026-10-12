import {
  appApiPath,
  agentNativePath,
} from "@agent-native/core/client/api-path";
import {
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { oauthRedirectUri } from "@agent-native/core/client/host";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useOrgRole } from "@agent-native/core/client/org";
import { mcpIntegrationLogo } from "@agent-native/core/client/resources/mcp-integration-logos";
import { actionErrorMessage } from "@agent-native/core/client/use-action";
import { docsUrl } from "@agent-native/core/shared";
import { useSendToAgentChat } from "@agent-native/toolkit/app/chat";
import { PromptComposer } from "@agent-native/toolkit/app/chat/composer/index";
import {
  IntegrationGrid,
  type IntegrationGridItem,
} from "@agent-native/toolkit/app/integrations";
import { McpIntegrationLogo } from "@agent-native/toolkit/app/resources";
import {
  useCredentialSaveScope,
  WhoField,
} from "@agent-native/toolkit/app/settings";
import {
  IconAlertCircle,
  IconApi,
  IconBrandGithub,
  IconCheck,
  IconCircle,
  IconCopy,
  IconDotsVertical,
  IconExternalLink,
  IconFileSpreadsheet,
  IconKey,
  IconLoader2,
  IconPencil,
  IconPlugConnected,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { getIdToken } from "@/lib/auth";
import {
  dataSourceOAuthReturnPath,
  focusedDataSourceFromSearchParams,
  getOptionalCredentialKeys,
  getSharedConnectionStatus,
  getGoogleDriveConnection,
  isWorkspaceOAuthSource,
  isSourceReady,
  isSourceLocallyConfigured,
  shouldOfferWorkspaceOAuthReconnect,
  shouldShowWorkspaceOAuthAdminNotice,
  credentialRowsFromStatus,
  type DataSourceStatusResponse,
  type EnvKeyStatus,
  type SharedConnectionStatus,
} from "@/lib/data-source-status";
import {
  dataSources,
  categoryLabels,
  categoryOrder,
  DATA_SOURCE_LOGO_IDS,
  type DataSource,
  type DataSourceCategory,
  type WalkthroughStep,
} from "@/lib/data-sources";

import {
  ConnectionTestStatus,
  type ConnectionTestResult,
} from "../components/ConnectionTestStatus";
import { CustomApiPanel } from "../components/CustomApiCard";

interface AnalyticsPublicKeyRow {
  id: string;
  name: string;
  publicKeyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  orgId: string | null;
  replayAllowedOrigins: string[];
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

interface FirstPartyAnalyticsHealthResponse {
  status: "healthy" | "monitor" | "recommend_bigquery" | "unavailable";
  externalBackendRecommendation?: "none" | "connect" | "use" | "unknown";
  metrics: {
    eventCount: number;
    slowQueryCount24h: number;
    maxQueryDurationMs24h: number;
  };
  externalBackends?: Array<{
    id: "bigquery" | "amplitude";
    label: string;
    role: "warehouse" | "product-analytics";
    configured: boolean | null;
    setupLink: string;
  }>;
  bigQuery: {
    configured: boolean | null;
  };
}

/** One row on the page: a data source, Google Sheets export, Custom API, or first-party analytics. */
interface SourceEntry {
  id: string;
  name: string;
  description?: string;
  category: DataSourceCategory;
  logo: ReactNode;
  status?: string;
  statusClassName?: string;
  connected: boolean;
  searchText: string;
  detail: ReactNode;
}

const firstPartyAnalyticsEndpoint =
  (import.meta.env as Record<string, string | undefined>)
    .VITE_AGENT_NATIVE_ANALYTICS_ENDPOINT ||
  "https://analytics.agent-native.com/track";

/**
 * Logos come from the shared table the Settings integrations tab uses. A
 * Tabler icon stands in only when that table has no logo for the id.
 */
function SourceLogo({
  id,
  name,
  fallbackIcon: FallbackIcon,
}: {
  id: string;
  name: string;
  fallbackIcon: DataSource["icon"];
}) {
  const logoId = DATA_SOURCE_LOGO_IDS[id] ?? id;
  const logoUrl = mcpIntegrationLogo(logoId);
  if (!logoUrl) {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground">
        <FallbackIcon className="size-4" aria-hidden="true" />
      </span>
    );
  }
  return (
    <McpIntegrationLogo
      name={name}
      logoUrl={logoUrl}
      integrationId={logoId}
      className="size-8"
      imageClassName="size-6"
    />
  );
}

async function saveEnvVars(
  vars: Array<{ key: string; value: string }>,
  scope: "user" | "org",
): Promise<void> {
  await callAction("update-data-source-credentials", { vars, scope });
}

async function testConnection(source: string): Promise<ConnectionTestResult> {
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

const GITHUB_OAUTH_STATUS_ABORT_MS = 10_000;

async function fetchGitHubOAuthStatus(): Promise<GitHubOAuthStatus> {
  const controller = new AbortController();
  const abortTimer = setTimeout(
    () => controller.abort(),
    GITHUB_OAUTH_STATUS_ABORT_MS,
  );
  let res: Response;
  try {
    res = await fetch(agentNativePath("/_agent-native/oauth/github/status"), {
      signal: controller.signal,
    });
  } finally {
    clearTimeout(abortTimer);
  }
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
  await callAction("delete-data-source-credentials", { keys });
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
    void queryClient.invalidateQueries({ queryKey: ["github-oauth-status"] });
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
      let inFlight = false;
      const pollId = window.setInterval(async () => {
        if (document.hidden || inFlight) return;
        inFlight = true;
        try {
          await queryClient.invalidateQueries({
            queryKey: ["github-oauth-status"],
          });
          onSaved();
        } finally {
          inFlight = false;
        }
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
    <div className="space-y-3 rounded-md bg-muted/30 p-3">
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

function startWorkspaceOAuth(provider: string, returnPath: string): void {
  const params = new URLSearchParams({
    appId: "analytics",
    return: returnPath,
  });
  window.location.assign(
    agentNativePath(
      `/_agent-native/connections/oauth/${provider}/start?${params.toString()}`,
    ),
  );
}

function WorkspaceOAuthView({
  provider,
  label,
  connected,
  returnPath = "/data-sources",
}: {
  provider: string;
  label: string;
  connected: boolean;
  returnPath?: string;
}) {
  const t = useT();

  return (
    <div className="space-y-3 rounded-md bg-muted/30 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
            <IconPlugConnected className="h-4 w-4" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium text-foreground">{label}</p>
            <p className="text-xs text-muted-foreground">
              {t("dataSources.sharedIntegration")}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant={connected ? "outline" : "default"}
          onClick={() => startWorkspaceOAuth(provider, returnPath)}
          className="shrink-0 text-xs"
        >
          {connected ? t("dataSources.reconnect") : t("dataSources.connect")}
        </Button>
      </div>
    </div>
  );
}

function SharedConnectionBadge({ status }: { status: SharedConnectionStatus }) {
  const t = useT();
  const tone = {
    ready:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    needs_grant:
      "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    needs_credentials: "border-border/60 bg-background text-muted-foreground",
    local_credentials: "border-border/60 bg-muted text-muted-foreground",
    needs_reauth:
      "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    error: "border-destructive/30 bg-destructive/10 text-destructive",
  }[status.kind];
  const label =
    status.kind === "needs_reauth"
      ? t("dataSources.reconnect")
      : status.kind === "error"
        ? t("dataSources.connectionFailed")
        : status.label;

  return (
    <Badge variant="outline" className={tone}>
      {label}
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
        : status.kind === "needs_reauth"
          ? t("dataSources.sharedNeedsReauth")
          : status.kind === "error"
            ? t("dataSources.sharedError")
            : status.kind === "local_credentials"
              ? t("dataSources.sharedLocalCredentials")
              : t("dataSources.sharedFallback");

  return (
    <div className="mb-4 flex items-start justify-between gap-3 rounded-md bg-muted/30 p-3">
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
  sharedConnectionStatus,
  canManageOrg,
  oauthReturnPath,
  onSaved,
  onAddLocalCredentials,
}: {
  source: DataSource;
  sharedConnectionStatus: SharedConnectionStatus | null;
  canManageOrg: boolean;
  oauthReturnPath: string;
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
  const canReconnect = shouldOfferWorkspaceOAuthReconnect(
    source,
    sharedConnectionStatus,
    canManageOrg,
    testResult?.ok === false,
  );

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
        {canReconnect && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => startWorkspaceOAuth(source.id, oauthReturnPath)}
            className="text-xs"
          >
            {t("dataSources.reconnect")}
          </Button>
        )}
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
      <ConnectionTestStatus
        result={testResult}
        pending={testMutation.isPending}
        error={testMutation.error}
      />
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
  const saveScope = useCredentialSaveScope();
  const whoId = useId();

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!saveScope.scope) return;
      const vars: Array<{ key: string; value: string }> = [];
      for (const [key, value] of Object.entries(inputValues)) {
        const trimmed = value.trim();
        if (trimmed) vars.push({ key, value: trimmed });
      }
      for (const key of pendingClears) {
        if (!inputValues[key]?.trim()) vars.push({ key, value: "" });
      }
      if (vars.length === 0) return;
      await saveEnvVars(vars, saveScope.scope);
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
        void queryClient.invalidateQueries({
          queryKey: ["github-oauth-status"],
        });
      }
      onSaved();
    },
  });

  const testMutation = useMutation({
    mutationFn: () => testConnection(source.id),
    onSuccess: (result) => {
      setTestResult(result);
      onSaved();
    },
  });

  const hasInputValues =
    Object.values(inputValues).some((v) => v.trim()) || pendingClears.size > 0;

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
        {saveScope.canChoose && saveScope.scope ? (
          <WhoField
            id={whoId}
            choice
            scope={saveScope.scope}
            disabled={saveMutation.isPending}
            onChange={saveScope.setScope}
          />
        ) : null}
        <div className="flex items-center gap-2 pt-2">
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={
              saveMutation.isPending || !hasInputValues || !saveScope.scope
            }
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
                size="icon-sm"
                variant="ghost"
                className="-mr-1 -mt-1 shrink-0 text-muted-foreground hover:text-foreground"
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

        <ConnectionTestStatus
          result={testResult}
          pending={testMutation.isPending}
          error={testMutation.error}
        />
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
          <div className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
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

/** Setup sheet body for a data source: walkthrough, credentials, workspace connection, and test. */
function DataSourceDetail({
  source,
  locallyConfigured,
  ready,
  sharedConnectionStatus,
  envStatus,
  statusUnknown,
  canManageOrg,
  orgLoaded,
  hasOrg,
  focused,
  oauthReturnPath,
  showAskContinuation,
  onSaved,
}: {
  source: DataSource;
  locallyConfigured: boolean;
  ready: boolean;
  sharedConnectionStatus: SharedConnectionStatus | null;
  envStatus: EnvKeyStatus[];
  statusUnknown: boolean;
  canManageOrg: boolean;
  orgLoaded: boolean;
  hasOrg: boolean;
  focused: boolean;
  oauthReturnPath: string;
  showAskContinuation: boolean;
  onSaved: () => void;
}) {
  const t = useT();
  const [currentStep, setCurrentStep] = useState(0);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [showLocalCredentials, setShowLocalCredentials] = useState(false);
  const totalSteps = source.walkthroughSteps.length;
  const saveScope = useCredentialSaveScope();
  const whoId = useId();

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!saveScope.scope) return;
      const vars = Object.entries(inputValues)
        .filter(([, v]) => v.trim())
        .map(([key, value]) => ({ key, value: value.trim() }));
      if (vars.length === 0) return;
      await saveEnvVars(vars, saveScope.scope);
    },
    onSuccess: () => {
      setInputValues({});
      onSaved();
    },
  });

  const hasInputValues = Object.values(inputValues).some((v) => v.trim());
  const readyViaWorkspace = sharedConnectionStatus?.kind === "ready";
  const showCredentialSetup =
    !locallyConfigured && (!readyViaWorkspace || showLocalCredentials);
  const preferWorkspaceSetup =
    isWorkspaceOAuthSource(source) &&
    !locallyConfigured &&
    !readyViaWorkspace &&
    !showLocalCredentials;
  const workspaceRoleLoading =
    isWorkspaceOAuthSource(source) && !ready && !orgLoaded;
  const showUnknownStatus = statusUnknown && !ready && !showLocalCredentials;

  if (showUnknownStatus) {
    return (
      <div className="space-y-3">
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <IconAlertCircle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
          {t("dataSources.statusUnknownDescription")}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowLocalCredentials(true)}
          className="text-xs"
        >
          {t("dataSources.addLocalCredentials")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {focused && ready && showAskContinuation && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-emerald-500/10 p-3">
          <span className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <IconCheck className="h-3.5 w-3.5" />
            {t("dataSources.connectionSuccessful")}
          </span>
          <Button asChild size="sm" className="text-xs">
            <Link to="/ask">{t("navigation.ask")}</Link>
          </Button>
        </div>
      )}
      {source.id === "github" && (
        <GitHubOAuthView connected={locallyConfigured} onSaved={onSaved} />
      )}
      {shouldShowWorkspaceOAuthAdminNotice(
        source,
        ready,
        canManageOrg,
        orgLoaded,
        hasOrg,
      ) && (
        <div className="rounded-md bg-muted/30 p-3">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
              <IconPlugConnected className="h-4 w-4" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-medium text-foreground">
                {t("dataSources.workspaceAdminRequiredTitle")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("dataSources.workspaceAdminRequiredDescription", {
                  name: source.name,
                })}
              </p>
            </div>
          </div>
        </div>
      )}
      {sharedConnectionStatus &&
        sharedConnectionStatus.kind !== "needs_credentials" &&
        sharedConnectionStatus.kind !== "needs_grant" && (
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
          sharedConnectionStatus={sharedConnectionStatus}
          canManageOrg={canManageOrg}
          oauthReturnPath={oauthReturnPath}
          onSaved={onSaved}
          onAddLocalCredentials={() => setShowLocalCredentials(true)}
        />
      ) : workspaceRoleLoading ? (
        <Skeleton className="h-9 w-full rounded-md" />
      ) : preferWorkspaceSetup && canManageOrg ? (
        <WorkspaceOAuthView
          provider={source.id}
          label={source.name}
          connected={sharedConnectionStatus?.kind === "needs_grant"}
          returnPath={oauthReturnPath}
        />
      ) : preferWorkspaceSetup ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowLocalCredentials(true)}
          className="text-xs"
        >
          {t("dataSources.useKeyJustInThisApp" /* i18n-key-ignore */, {
            defaultValue: "Use a key just in this app",
          })}
        </Button>
      ) : (
        <>
          {/* Step progress */}
          <div className="flex items-center gap-1.5">
            {source.walkthroughSteps.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentStep(i)}
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
              <div className="flex items-center gap-2 pt-1">
                {currentStep > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setCurrentStep((s) => s - 1)}
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
                    onClick={() => setCurrentStep((s) => s + 1)}
                    className="text-xs"
                  >
                    {t("dataSources.continue")}
                  </Button>
                )}
              </div>
            );
          })()}

          {hasInputValues && saveScope.canChoose && saveScope.scope ? (
            <WhoField
              id={whoId}
              choice
              scope={saveScope.scope}
              disabled={saveMutation.isPending}
              onChange={saveScope.setScope}
            />
          ) : null}
          <div className="flex items-center gap-2 pt-1">
            {hasInputValues && (
              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !saveScope.scope}
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
              >
                {t("dataSources.docs")} <IconExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {saveMutation.isError && (
            <div className="flex items-center gap-2 text-xs text-rose-400">
              <IconAlertCircle className="h-3.5 w-3.5" />
              {(saveMutation.error as Error).message}
            </div>
          )}
          {saveMutation.isSuccess && (
            <div className="flex items-center gap-2 text-xs text-emerald-500">
              <IconCheck className="h-3.5 w-3.5" />
              {t("dataSources.credentialsSaved")}
            </div>
          )}
        </>
      )}
    </div>
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
          className="shrink-0 gap-1.5"
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
        className="relative w-[calc(100vw-2rem)] p-3 sm:w-[420px]"
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
          requireAgentEngine
          disabled={isGenerating}
          placeholder={t("dataSources.addDataSourcePlaceholder")}
          draftScope="analytics:add-data-source"
          onSubmit={handleSubmit}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * First-party analytics keys and backend health. The list row and the setup
 * sheet both read this; react-query shares the requests between them.
 */
function useFirstPartyAnalyticsData() {
  const keysQuery = useActionQuery("list-analytics-public-keys", undefined, {
    staleTime: 10_000,
  });
  const healthQuery = useActionQuery(
    "get-first-party-analytics-health",
    undefined,
    { staleTime: 30_000, retry: false },
  );
  const keys = (
    (keysQuery.data as AnalyticsPublicKeyRow[] | undefined) ?? []
  ).filter((key) => !key.revokedAt);
  const health = healthQuery.data as
    | FirstPartyAnalyticsHealthResponse
    | undefined;
  const healthStatus = healthQuery.isError ? "unavailable" : health?.status;
  const externalBackends = health?.externalBackends ?? [];
  const externalBackendConfigured = health?.bigQuery.configured === true;
  const recommendsExternalBackend = healthStatus === "recommend_bigquery";
  const healthTitleKey = recommendsExternalBackend
    ? externalBackendConfigured
      ? "analyticsBackend.connectedTitle"
      : "analyticsBackend.recommendationTitle"
    : null;
  const healthDescriptionKey = recommendsExternalBackend
    ? externalBackendConfigured
      ? "analyticsBackend.connectedDescription"
      : "analyticsBackend.recommendationDescription"
    : healthStatus === "monitor"
      ? "analyticsBackend.monitorDescription"
      : healthStatus === "healthy"
        ? "analyticsBackend.healthyDescription"
        : "analyticsBackend.unavailableDescription";

  return {
    keysLoading: keysQuery.isLoading,
    keys,
    connected: keys.length > 0,
    health,
    healthLoading: healthQuery.isLoading,
    healthStatus,
    externalBackends,
    recommendsExternalBackend,
    healthTitleKey,
    healthDescriptionKey,
  };
}

// Keep captureException() and captureMessage() verbatim in every translation:
// the split below renders them as inline code.
const SDK_CAPTURE_CALL_PATTERN = /(captureException\(\)|captureMessage\(\))/;

/** First-party analytics setup sheet body: backend health, SDK env, keys, and replay origins. */
function FirstPartyAnalyticsDetail() {
  const t = useT();
  const formatters = useFormatters();
  const formatNumber = formatters.formatNumber.bind(formatters);
  const queryClient = useQueryClient();
  const {
    keys,
    health,
    healthLoading,
    healthStatus,
    externalBackends,
    recommendsExternalBackend,
    healthTitleKey,
    healthDescriptionKey,
  } = useFirstPartyAnalyticsData();
  const [name, setName] = useState(() => t("dataSources.defaultKeyName"));
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingOriginsFor, setEditingOriginsFor] =
    useState<AnalyticsPublicKeyRow | null>(null);
  const [originDraft, setOriginDraft] = useState("");

  const createKey = useActionMutation("create-analytics-public-key", {
    onSuccess: (result: any) => {
      setCreatedKey(result.publicKey);
      setCopied(false);
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-analytics-public-keys"],
      });
    },
  });

  const revokeKey = useActionMutation("revoke-analytics-public-key", {
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-analytics-public-keys"],
      });
    },
  });

  const updateKeyOrigins = useActionMutation("update-analytics-public-key", {
    method: "PUT",
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-analytics-public-keys"],
      });
      setEditingOriginsFor(null);
      setOriginDraft("");
    },
  });

  const addReplayOrigins = () => {
    if (!editingOriginsFor) return;
    const origins = originDraft
      .split(/\r?\n/)
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (origins.length === 0) return;
    updateKeyOrigins.mutate({
      id: editingOriginsFor.id,
      addReplayAllowedOrigins: origins,
    });
  };

  const copyCreatedKey = async () => {
    if (!createdKey) return;
    await navigator.clipboard?.writeText(createdKey);
    setCopied(true);
  };

  return (
    <div className="space-y-4">
      {healthLoading ? (
        <Skeleton className="h-28 w-full rounded-md" />
      ) : (
        <div
          className={`rounded-md p-3 text-xs ${
            recommendsExternalBackend ? "bg-amber-500/10" : "bg-muted/30"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <IconAlertCircle
                className={`mt-px h-3.5 w-3.5 shrink-0 ${
                  recommendsExternalBackend
                    ? "text-amber-500"
                    : "text-muted-foreground"
                }`}
              />
              <div className="min-w-0 space-y-1">
                {healthTitleKey && (
                  <p className="font-medium text-foreground">
                    {t(healthTitleKey)}
                  </p>
                )}
                <p className="text-muted-foreground">
                  {t(healthDescriptionKey)}
                </p>
              </div>
            </div>
          </div>
          {externalBackends.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-muted-foreground">
                {t("analyticsBackend.options")}
              </div>
              <div className="flex flex-wrap gap-2">
                {externalBackends.map((backend) => {
                  const statusLabel =
                    backend.configured === true
                      ? t("analyticsBackend.configured")
                      : backend.configured === false
                        ? t("analyticsBackend.setUp")
                        : t("dataSources.statusUnknown");
                  return (
                    <Button
                      asChild
                      key={backend.id}
                      size="sm"
                      variant={
                        backend.configured === true ? "outline" : "default"
                      }
                      className="text-xs"
                    >
                      <Link to={backend.setupLink}>
                        {backend.label} · {statusLabel}
                      </Link>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
          {health && healthStatus !== "unavailable" && (
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div>
                <div className="text-muted-foreground">
                  {t("dataSources.analyticsEventCount")}
                </div>
                <div className="font-medium text-foreground">
                  {formatNumber(health.metrics.eventCount)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">
                  {t("dataSources.slowQueries24h")}
                </div>
                <div className="font-medium text-foreground">
                  {formatNumber(health.metrics.slowQueryCount24h)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">
                  {t("dataSources.maxQueryDuration")}
                </div>
                <div className="font-medium text-foreground">
                  {formatNumber(health.metrics.maxQueryDurationMs24h / 1_000, {
                    maximumFractionDigits: 1,
                  })}
                  s
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="grid gap-2 rounded-md bg-muted/30 p-3 text-xs">
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

      {/* Error capture note — the analytics SDK also captures uncaught
          exceptions and links them to session replays. The heading and
          docs link stay static English because shared i18n is owned
          elsewhere. */}
      <div className="rounded-md bg-muted/30 p-3 text-xs">
        <div className="font-medium text-foreground">
          Error capture{/* i18n-ignore static SDK docs label */}
        </div>
        <p className="mt-1 text-muted-foreground">
          {t("dataSources.firstPartySdkAutoCapture")
            .split(SDK_CAPTURE_CALL_PATTERN)
            .map((part, index) =>
              index % 2 === 1 ? (
                <code key={index} className="font-mono">
                  {part}
                </code>
              ) : (
                part
              ),
            )}
        </p>
        <a
          href={docsUrl("tracking", { hash: "posthog-error-tracking" })}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          Error capture docs{/* i18n-ignore static SDK docs link */}
          <IconExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="data-source-inline-form">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("dataSources.keyNamePlaceholder")}
          className="min-w-0 flex-1"
        />
        <Button
          size="sm"
          onClick={() => createKey.mutate({ name })}
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
        <div className="space-y-2 rounded-md bg-emerald-500/10 p-3">
          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
            {t("dataSources.newKeyGenerated")}
          </p>
          <div className="flex gap-2">
            <Input
              readOnly
              value={createdKey}
              className="min-w-0 flex-1 font-mono text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copyCreatedKey()}
              className="text-xs"
            >
              <IconCopy className="h-3 w-3 mr-1.5" />
              {copied ? t("dataSources.copied") : t("dataSources.copy")}
            </Button>
          </div>
        </div>
      )}

      {keys.length > 0 && (
        <div className="space-y-2 pt-1">
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
                        date: new Date(key.lastUsedAt).toLocaleDateString(),
                      })}`
                    : ` ${t("dataSources.neverUsed")}`}
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={t("dataSources.keyActions", {
                      name: key.name,
                    })}
                  >
                    <IconDotsVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem
                    onSelect={() => {
                      updateKeyOrigins.reset();
                      setOriginDraft("");
                      setEditingOriginsFor(key);
                    }}
                  >
                    {t("dataSources.manageReplayOrigins")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
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

      <Dialog
        open={editingOriginsFor !== null}
        onOpenChange={(open) => {
          if (!open && !updateKeyOrigins.isPending) {
            setEditingOriginsFor(null);
            setOriginDraft("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dataSources.manageReplayOrigins")}</DialogTitle>
            <DialogDescription>
              {t("dataSources.replayOriginsDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium">
                {t("dataSources.currentReplayOrigins")}
              </p>
              {editingOriginsFor?.replayAllowedOrigins.length ? (
                <ul className="max-h-32 space-y-1 overflow-y-auto rounded-md bg-muted/40 p-2 text-xs">
                  {editingOriginsFor.replayAllowedOrigins.map((origin) => (
                    <li key={origin} className="break-all font-mono">
                      {origin}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("dataSources.anyReplayOriginAllowed")}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="analytics-replay-origins"
                className="text-xs font-medium"
              >
                {t("dataSources.originsToAdd")}
              </label>
              <Textarea
                id="analytics-replay-origins"
                value={originDraft}
                onChange={(event) => setOriginDraft(event.target.value)}
                placeholder={t("dataSources.replayOriginsPlaceholder")}
                rows={4}
                disabled={updateKeyOrigins.isPending}
              />
            </div>
            {updateKeyOrigins.isError && (
              <p role="alert" className="text-xs text-destructive">
                {actionErrorMessage(updateKeyOrigins.error) ??
                  t("dataSources.replayOriginsUpdateFailed")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingOriginsFor(null)}
              disabled={updateKeyOrigins.isPending}
            >
              {t("dataSources.cancel")}
            </Button>
            <Button
              type="button"
              onClick={addReplayOrigins}
              disabled={updateKeyOrigins.isPending || !originDraft.trim()}
            >
              {updateKeyOrigins.isPending
                ? t("dataSources.addingReplayOrigins")
                : t("dataSources.addReplayOrigins")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SourceSection({
  title,
  entries,
  onOpen,
}: {
  title: string;
  entries: SourceEntry[];
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const items: IntegrationGridItem[] = entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    logo: entry.logo,
    status: entry.status,
    statusClassName: entry.statusClassName,
    actionKind: entry.connected ? "manage" : "connect",
    actionLabel: entry.connected
      ? t("dataSources.manage")
      : t("dataSources.connect"),
    onAction: () => onOpen(entry.id),
  }));
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <IntegrationGrid variant="rows" items={items} />
    </section>
  );
}

export default function DataSources() {
  const t = useT();
  const { canManageOrg, isLoading: isOrgRoleLoading, org } = useOrgRole();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const focusedSourceResolution =
    focusedDataSourceFromSearchParams(searchParams);
  const focusedSource =
    focusedSourceResolution.status === "found"
      ? focusedSourceResolution.source
      : undefined;
  const unknownFocusedSourceId =
    focusedSourceResolution.status === "unknown"
      ? focusedSourceResolution.requestedId
      : null;
  const focusedSourceId = focusedSource?.id ?? "";
  const showAskContinuation = searchParams.get("returnTo") === "ask";
  const [search, setSearch] = useState(() => focusedSource?.name ?? "");
  const [activeId, setActiveId] = useState(focusedSourceId);
  const [sheetOpen, setSheetOpen] = useState(focusedSourceId !== "");
  const oauthReturnPath = dataSourceOAuthReturnPath(
    focusedSource,
    showAskContinuation,
  );

  useEffect(() => {
    if (focusedSource) {
      setSearch(focusedSource.name);
    } else if (unknownFocusedSourceId) {
      setSearch("");
    }
  }, [focusedSource, unknownFocusedSourceId]);

  // A deep link to ?source=<id> opens that source's setup sheet.
  useEffect(() => {
    if (!focusedSourceId) return;
    setActiveId(focusedSourceId);
    setSheetOpen(true);
  }, [focusedSourceId]);

  const {
    data: rawStatusData,
    isLoading: isStatusLoading,
    isError: isStatusError,
  } = useActionQuery("data-source-status", undefined, {
    staleTime: 10_000,
  });
  const statusData = rawStatusData as DataSourceStatusResponse | undefined;
  const envStatus = credentialRowsFromStatus(statusData);
  const statusUnknown =
    !isStatusLoading &&
    (isStatusError ||
      !statusData ||
      Boolean(statusData.error) ||
      statusData.workspaceConnections?.available === false);

  const firstParty = useFirstPartyAnalyticsData();
  const googleSheetsConnected =
    getGoogleDriveConnection(statusData)?.grantState === "connected";

  const handleSaved = () => {
    void queryClient.invalidateQueries({
      queryKey: ["action", "data-source-status"],
    });
  };

  const sourceEntries: SourceEntry[] = dataSources.map((source) => {
    const locallyConfigured = isSourceLocallyConfigured(
      source,
      statusData,
      envStatus,
    );
    const ready = isSourceReady(source, statusData, envStatus);
    const sharedConnectionStatus = getSharedConnectionStatus(
      source,
      statusData,
      envStatus,
    );
    const readyViaWorkspace = sharedConnectionStatus?.kind === "ready";
    const status = ready
      ? {
          label:
            readyViaWorkspace && !locallyConfigured
              ? t("dataSources.ready")
              : t("dataSources.configured"),
          className: "text-emerald-500",
        }
      : statusUnknown
        ? {
            label: t("dataSources.statusUnknown"),
            className: "text-amber-500",
          }
        : sharedConnectionStatus?.kind === "needs_reauth"
          ? {
              label: t("dataSources.reconnect"),
              className: "text-amber-600 dark:text-amber-400",
            }
          : sharedConnectionStatus?.kind === "error"
            ? {
                label: t("dataSources.connectionFailed"),
                className: "text-destructive",
              }
            : {
                label: t("dataSources.notConfigured"),
                className: "text-muted-foreground",
              };
    return {
      id: source.id,
      name: source.name,
      description: source.description,
      category: source.category,
      logo: (
        <SourceLogo
          id={source.id}
          name={source.name}
          fallbackIcon={source.icon}
        />
      ),
      status: isStatusLoading ? undefined : status.label,
      statusClassName: status.className,
      connected: ready,
      searchText: `${source.name} ${source.description}`.toLowerCase(),
      detail: (
        <DataSourceDetail
          source={source}
          locallyConfigured={locallyConfigured}
          ready={ready}
          sharedConnectionStatus={sharedConnectionStatus}
          envStatus={envStatus}
          statusUnknown={statusUnknown}
          canManageOrg={canManageOrg}
          orgLoaded={!isOrgRoleLoading}
          hasOrg={Boolean(org?.orgId)}
          focused={source.id === focusedSourceId}
          oauthReturnPath={oauthReturnPath}
          showAskContinuation={showAskContinuation}
          onSaved={handleSaved}
        />
      ),
    };
  });

  const firstPartyStatus = firstParty.recommendsExternalBackend
    ? {
        label: t(
          firstParty.healthTitleKey ?? "analyticsBackend.recommendationTitle",
        ),
        className: "text-amber-500",
      }
    : firstParty.connected
      ? {
          label: t("analyticsBackend.configured"),
          className: "text-emerald-500",
        }
      : {
          label: t("dataSources.notConfigured"),
          className: "text-muted-foreground",
        };

  const firstPartyEntry: SourceEntry = {
    id: "first-party-analytics",
    name: t("dataSources.firstPartyAnalytics"),
    description: t("dataSources.firstPartyDescription"),
    category: "analytics",
    logo: (
      <SourceLogo
        id="first-party-analytics"
        name={t("dataSources.firstPartyAnalytics")}
        fallbackIcon={IconKey}
      />
    ),
    status: firstParty.keysLoading ? undefined : firstPartyStatus.label,
    statusClassName: firstPartyStatus.className,
    connected: firstParty.connected,
    searchText: [
      t("dataSources.firstPartyAnalytics"),
      t("dataSources.firstPartyDescription"),
      "first-party analytics tracking observability llm ai generation $ai_generation posthog agent-native analytics AGENT_NATIVE_ANALYTICS_PUBLIC_KEY VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY",
    ]
      .join(" ")
      .toLowerCase(),
    detail: <FirstPartyAnalyticsDetail />,
  };

  const googleSheetsEntry: SourceEntry = {
    id: "google-sheets-export",
    name: t("dataSources.googleSheetsExport"),
    description: t("dataSources.googleSheetsExportDescription"),
    category: "analytics",
    logo: (
      <SourceLogo
        id="google-sheets-export"
        name={t("dataSources.googleSheetsExport")}
        fallbackIcon={IconFileSpreadsheet}
      />
    ),
    status: isStatusLoading
      ? undefined
      : googleSheetsConnected
        ? t("dataSources.connected")
        : t("dataSources.notConfigured"),
    statusClassName: googleSheetsConnected
      ? "text-emerald-500"
      : "text-muted-foreground",
    connected: googleSheetsConnected,
    searchText: [
      t("dataSources.googleSheetsExport"),
      t("dataSources.googleSheetsExportDescription"),
    ]
      .join(" ")
      .toLowerCase(),
    detail: (
      <WorkspaceOAuthView
        provider="google_drive"
        label={t("dataSources.googleSheets")}
        connected={googleSheetsConnected}
      />
    ),
  };

  const customApiEntry: SourceEntry = {
    id: "custom-api",
    name: t("dataSources.customApi.title"),
    description: t("dataSources.customApi.description"),
    category: "engineering",
    logo: (
      <SourceLogo
        id="custom-api"
        name={t("dataSources.customApi.title")}
        fallbackIcon={IconApi}
      />
    ),
    connected: false,
    searchText: [
      t("dataSources.customApi.title"),
      t("dataSources.customApi.description"),
    ]
      .join(" ")
      .toLowerCase(),
    detail: <CustomApiPanel />,
  };

  const entries = [
    firstPartyEntry,
    ...sourceEntries,
    googleSheetsEntry,
    customApiEntry,
  ];
  const activeEntry = entries.find((entry) => entry.id === activeId);

  const openEntry = (id: string) => {
    setActiveId(id);
    setSheetOpen(true);
  };

  const normalizedSearch = search.trim().toLowerCase();
  const matchesSearch = (entry: SourceEntry) =>
    !normalizedSearch || entry.searchText.includes(normalizedSearch);
  // Connected sources lead the page, as on the Settings integrations tab, and
  // leave their category section so each source appears once.
  const connectedEntries = entries.filter(
    (entry) => entry.connected && matchesSearch(entry),
  );
  const groups = categoryOrder
    .map((category) => ({
      category,
      entries: entries.filter(
        (entry) =>
          entry.category === category &&
          !entry.connected &&
          matchesSearch(entry),
      ),
    }))
    .filter((group) => group.entries.length > 0);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <div className="flex items-center justify-end gap-2">
        <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
          <IconSearch
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("dataSources.searchPlaceholder")}
            aria-label={t("dataSources.searchPlaceholder")}
            className="ps-9"
          />
        </div>
        <AddDataSourceCTA />
      </div>

      {unknownFocusedSourceId && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300"
        >
          <IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t("dataSources.noMatch", { search: unknownFocusedSourceId })}
          </span>
        </div>
      )}

      {connectedEntries.length === 0 && groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("dataSources.noMatch", { search })}
        </p>
      ) : (
        <>
          {connectedEntries.length > 0 && (
            <SourceSection
              title={t("dataSources.connected")}
              entries={connectedEntries}
              onOpen={openEntry}
            />
          )}
          {groups.map((group) => (
            <SourceSection
              key={group.category}
              title={categoryLabels[group.category]}
              entries={group.entries}
              onOpen={openEntry}
            />
          ))}
        </>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          aria-describedby={undefined}
          className="w-full overflow-y-auto sm:max-w-lg"
        >
          {activeEntry ? (
            <>
              <SheetHeader className="pe-8">
                <div className="flex min-w-0 items-center gap-3">
                  {activeEntry.logo}
                  <SheetTitle className="truncate">
                    {activeEntry.name}
                  </SheetTitle>
                </div>
              </SheetHeader>
              <div className="data-source-card mt-5 min-w-0">
                {activeEntry.detail}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
