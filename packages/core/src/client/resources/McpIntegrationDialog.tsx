import { Alert, AlertDescription } from "@agent-native/toolkit/ui/alert";
import { Button } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@agent-native/toolkit/ui/input-group";
import { Label } from "@agent-native/toolkit/ui/label";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@agent-native/toolkit/ui/toggle-group";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconCheck,
  IconExternalLink,
  IconSearch,
} from "@tabler/icons-react";
import {
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { agentNativePath } from "../api-path.js";
import { openAgentSettings } from "../CommandMenu.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { useT } from "../i18n.js";
import { IntegrationConnectionChoice } from "../integrations/IntegrationConnectionChoice.js";
import { IntegrationGrid } from "../integrations/IntegrationGrid.js";
import { cn } from "../utils.js";
import {
  allowsMcpIntegrationPersonalScope,
  buildMcpOAuthStartUrl,
  createMcpIntegrationFormDefaults,
  filterMcpIntegrations,
  getMcpIntegrationApiFallback,
  getDefaultMcpIntegrations,
  isMcpIntegrationUrl,
  isCustomMcpIntegrationEnabled,
  mcpUrlRequiresOrganizationScope,
  navigateToMcpOAuthStart,
  requiresMcpIntegrationOrganizationScope,
  resolveMcpIntegrationScope,
  shouldOfferMcpIntegrationOrganizationScope,
  shouldOfferMcpOrganizationScope,
  supportsMcpIntegrationOrganizationScope,
  type DefaultMcpIntegration,
} from "./mcp-integration-catalog.js";
import { McpIntegrationLogo } from "./McpIntegrationLogo.js";
import {
  formatMcpServerError,
  formatMcpServersLoadError,
  getMcpUrlValidationError,
  useMcpServersApi,
  useMcpServers,
  type CreateMcpServerArgs,
  type McpServerScope,
} from "./use-mcp-servers.js";

type DialogMode = "catalog" | "choice" | "form";

export interface McpIntegrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialIntegrationId?: string | null;
  connectIntegrationId?: string | null;
  quickConnectIntegrationId?: string | null;
  presentation?: "takeover" | "modal";
  defaultScope: McpServerScope;
  canCreateOrgMcp: boolean;
  hasOrg: boolean;
  onCreateMcpServer: (args: CreateMcpServerArgs) => Promise<unknown>;
  onOAuthStart?: (url: string) => void | Promise<void>;
  oauthReady?: boolean;
  oauthReturnPath?: string;
  onCreated?: () => void;
  integrations?: DefaultMcpIntegration[];
}

interface TestResult {
  ok: boolean;
  message: string;
}

function parseHeaderLines(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function requiresMcpIntegrationSetup(
  integration: DefaultMcpIntegration,
): boolean {
  return Boolean(
    !integration.managedOAuth &&
    (integration.connectionMode === "manual" ||
      integration.availability === "provider-setup" ||
      integration.availability === "client-restricted"),
  );
}

function resolveIntegrationScope(
  integration: DefaultMcpIntegration | null | undefined,
  defaultScope: McpServerScope,
  hasOrg: boolean,
  canCreateOrgMcp: boolean,
): McpServerScope {
  return resolveMcpIntegrationScope(
    integration && requiresMcpIntegrationOrganizationScope(integration)
      ? "org"
      : defaultScope,
    hasOrg,
    canCreateOrgMcp,
    !integration ||
      (integration.supportsOrganizationScope === true &&
        integration.managedOAuth !== true),
  );
}

export function McpIntegrationDialog({
  open,
  onOpenChange,
  initialIntegrationId = null,
  connectIntegrationId = null,
  quickConnectIntegrationId = null,
  presentation = "takeover",
  defaultScope,
  canCreateOrgMcp,
  hasOrg,
  onCreateMcpServer,
  onOAuthStart,
  oauthReady = true,
  oauthReturnPath,
  onCreated,
  integrations,
}: McpIntegrationDialogProps) {
  const t = useT();
  const [mode, setMode] = useState<DialogMode>("catalog");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<DefaultMcpIntegration | null>(null);
  const safeDefaultScope = resolveMcpIntegrationScope(
    defaultScope,
    hasOrg,
    canCreateOrgMcp,
  );
  const [scope, setScope] = useState<McpServerScope>(safeDefaultScope);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [customAuthMode, setCustomAuthMode] = useState<"oauth" | "headers">(
    "oauth",
  );
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const fieldId = useId();
  const ids = {
    name: `${fieldId}-name`,
    url: `${fieldId}-url`,
    urlError: `${fieldId}-url-error`,
    description: `${fieldId}-description`,
    headers: `${fieldId}-headers`,
    scope: `${fieldId}-scope`,
  };
  const inputRef = useRef<HTMLInputElement>(null);
  const quickConnectAttemptedRef = useRef<string | null>(null);
  const quickConnectRef = useRef<
    ((integration: DefaultMcpIntegration) => void) | null
  >(null);
  const mcpApi = useMcpServersApi();
  // Rendered (closed) inside rail and settings surfaces that mount during
  // startup, so it waits out the paint window like its parents; the open
  // state already holds actions until the read succeeds.
  const mcpServersQuery = useMcpServers({ defer: true });
  const defaultIntegrations = useMemo(
    () => integrations ?? getDefaultMcpIntegrations(),
    [integrations],
  );
  const customIntegrationEnabled = useMemo(
    () => isCustomMcpIntegrationEnabled(),
    [],
  );
  const showCatalog = defaultIntegrations.length > 0;

  const connectedServers = useMemo(() => {
    const servers = [
      ...(mcpServersQuery.data?.user ?? []),
      ...(mcpServersQuery.data?.org ?? []),
    ];
    // A saved server is not necessarily a working connection. The settings
    // page reports failed and unknown health states separately, so only mark
    // catalog entries as connected after the health probe succeeds.
    return servers.filter((server) => server.status.state === "connected");
  }, [mcpServersQuery.data]);

  const filteredIntegrations = useMemo(
    () => filterMcpIntegrations(query, defaultIntegrations),
    [defaultIntegrations, query],
  );

  const selectedRequiresSetup = Boolean(
    selected && requiresMcpIntegrationSetup(selected),
  );

  useEffect(() => {
    if (!open) return;
    if (initialIntegrationId && !mcpServersQuery.isSuccess) return;
    const initialIntegration = initialIntegrationId
      ? defaultIntegrations.find(
          (integration) => integration.id === initialIntegrationId,
        )
      : null;
    const initialDefaults =
      createMcpIntegrationFormDefaults(initialIntegration);
    const initialNeedsScopeChoice = Boolean(
      initialIntegration &&
      // Org-only integrations reach the choice screen regardless of workspace
      // membership: the form would otherwise offer a personal connection the
      // server rejects, and with no workspace there is nothing else to explain
      // why the only option is unavailable.
      (requiresMcpIntegrationOrganizationScope(initialIntegration) ||
        (hasOrg &&
          requiresMcpIntegrationSetup(initialIntegration) &&
          supportsMcpIntegrationOrganizationScope(initialIntegration))),
    );
    setMode(
      initialNeedsScopeChoice
        ? "choice"
        : initialIntegration || !showCatalog
          ? "form"
          : "catalog",
    );
    setQuery("");
    setSelected(initialIntegration ?? null);
    setScope(
      resolveIntegrationScope(
        initialIntegration,
        defaultScope,
        hasOrg,
        canCreateOrgMcp,
      ),
    );
    setName(initialDefaults.name);
    setUrl(initialDefaults.url);
    setDescription(initialDefaults.description);
    setHeadersText(initialDefaults.headersText);
    setCustomAuthMode(initialIntegration ? "headers" : "oauth");
    setBusy(false);
    setTesting(false);
    setError(null);
    setUrlError(null);
    setTestResult(null);
  }, [
    defaultIntegrations,
    initialIntegrationId,
    canCreateOrgMcp,
    defaultScope,
    hasOrg,
    open,
    safeDefaultScope,
    showCatalog,
    mcpServersQuery.isSuccess,
  ]);

  useEffect(() => {
    if (open && mode === "form") {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(timer);
    }
  }, [mode, open]);

  const clearFeedback = () => {
    setError(null);
    setUrlError(null);
    setTestResult(null);
  };

  const openForm = (
    integration?: DefaultMcpIntegration | null,
    options?: { scope?: McpServerScope },
  ) => {
    const defaults = createMcpIntegrationFormDefaults(integration);
    setSelected(integration ?? null);
    setScope(
      options?.scope ??
        resolveIntegrationScope(
          integration,
          defaultScope,
          hasOrg,
          canCreateOrgMcp,
        ),
    );
    setName(defaults.name);
    setUrl(defaults.url);
    setDescription(defaults.description);
    setHeadersText(defaults.headersText);
    setCustomAuthMode(integration ? "headers" : "oauth");
    setError(null);
    setUrlError(null);
    setTestResult(null);
    setMode("form");
  };

  const beginOAuth = (
    args: {
      name: string;
      url: string;
      description: string;
    },
    options?: {
      scope?: McpServerScope;
    },
  ) => {
    if (!oauthReady) return;
    const validationError = getMcpUrlValidationError(args.url);
    if (validationError) {
      setError(validationError);
      setTestResult(null);
      return;
    }
    // A hand-entered org-only URL has no catalog entry to route it through the
    // workspace-only flow, so check eligibility here rather than navigating to
    // an OAuth start the server can only refuse.
    if (
      mcpUrlRequiresOrganizationScope(args.url) &&
      !(hasOrg && canCreateOrgMcp)
    ) {
      setError(t("mcpIntegrations.workspaceOnlyDescription"));
      setTestResult(null);
      return;
    }
    setBusy(true);
    const returnUrl = oauthReturnPath?.startsWith("/")
      ? oauthReturnPath
      : typeof window === "undefined"
        ? "/"
        : window.location.pathname +
          window.location.search +
          window.location.hash;
    const oauthUrl = agentNativePath(
      buildMcpOAuthStartUrl({
        name: args.name,
        url: args.url,
        description: args.description,
        scope: options?.scope ?? scope,
        returnUrl,
      }),
    );
    if (!onOAuthStart) {
      const opened = navigateToMcpOAuthStart(oauthUrl);
      setBusy(false);
      if (opened) {
        onOpenChange(false);
      } else {
        setError(t("mcpIntegrations.connectionError"));
      }
      return;
    }
    void Promise.resolve()
      .then(() => onOAuthStart(oauthUrl))
      .then(() => onOpenChange(false))
      .catch((cause: unknown) => {
        setBusy(false);
        setError(formatMcpServerError(cause));
      });
  };

  const connectWithOAuth = (
    integration: DefaultMcpIntegration,
    options?: { scope?: McpServerScope },
  ) =>
    beginOAuth(
      {
        name: integration.name,
        url: integration.url,
        description: integration.description,
      },
      {
        ...options,
        scope:
          options?.scope ??
          (integration.supportsOrganizationScope === true &&
          integration.managedOAuth !== true
            ? scope
            : "user"),
      },
    );

  const connectCustomWithOAuth = () => {
    if (!name.trim()) {
      setError(t("mcpIntegrations.serverNameRequired"));
      return;
    }
    beginOAuth({
      name: name.trim(),
      url: url.trim(),
      description: description.trim(),
    });
  };

  const connectSelectedWithOAuth = () => {
    if (!name.trim()) {
      setError(t("mcpIntegrations.serverNameRequired"));
      return;
    }
    beginOAuth({
      name: name.trim(),
      url: url.trim(),
      description: description.trim(),
    });
  };

  const createServer = async (args: CreateMcpServerArgs) => {
    const validationError = getMcpUrlValidationError(args.url);
    if (validationError) {
      setError(validationError);
      setTestResult(null);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onCreateMcpServer(args);
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      setError(formatMcpServerError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitForm = () => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl || busy) return;
    void createServer({
      scope,
      name: trimmedName,
      url: trimmedUrl,
      headers: parseHeaderLines(headersText),
      description: description.trim() || undefined,
    });
  };

  // Org-only integrations have no personal connection to fall back to, so they
  // must never reach the user-scoped paths below. When the workspace connection
  // is available we start it directly; otherwise the choice screen is the only
  // surface that can explain why nothing here is actionable yet.
  const routeOrganizationOnlyIntegration = (
    integration: DefaultMcpIntegration,
  ): boolean => {
    if (!requiresMcpIntegrationOrganizationScope(integration)) return false;
    if (hasOrg && canCreateOrgMcp) {
      connectWorkspace(integration);
      return true;
    }
    setSelected(integration);
    setMode("choice");
    return true;
  };

  const quickConnect = (integration: DefaultMcpIntegration) => {
    if (routeOrganizationOnlyIntegration(integration)) return;
    if (hasOrg && supportsMcpIntegrationOrganizationScope(integration)) {
      setSelected(integration);
      setMode("choice");
      return;
    }
    if (!integration.url.trim()) {
      openForm(integration);
      return;
    }
    if (requiresMcpIntegrationSetup(integration)) {
      openForm(integration);
      return;
    }
    if (integration.authMode === "oauth") {
      connectWithOAuth(integration, {
        scope: "user",
      });
      return;
    }
    if (integration.authMode === "headers") {
      openForm(integration);
      return;
    }
    void createServer({
      scope: "user",
      name: integration.name,
      url: integration.url,
      description: integration.description,
    });
  };

  const selectCatalogConnection = (integration: DefaultMcpIntegration) => {
    if (!mcpServersQuery.isSuccess) return;
    if (routeOrganizationOnlyIntegration(integration)) return;
    if (hasOrg && supportsMcpIntegrationOrganizationScope(integration)) {
      setSelected(integration);
      setMode("choice");
      return;
    }
    if (requiresMcpIntegrationSetup(integration)) {
      const apiFallback = getMcpIntegrationApiFallback(integration);
      if (apiFallback) {
        openAgentSettings(`secrets:${apiFallback.secretKey}`);
      } else {
        openForm(integration);
      }
      return;
    }
    quickConnect(integration);
  };

  quickConnectRef.current = quickConnect;

  useEffect(() => {
    if (!open) {
      quickConnectAttemptedRef.current = null;
      return;
    }
    if (
      !quickConnectIntegrationId ||
      quickConnectAttemptedRef.current === quickConnectIntegrationId
    ) {
      return;
    }
    if (mcpServersQuery.isError) return;
    if (!mcpServersQuery.isSuccess) return;
    const integration = defaultIntegrations.find(
      (candidate) => candidate.id === quickConnectIntegrationId,
    );
    if (!integration) return;
    if (integration.authMode === "oauth" && !oauthReady) return;
    quickConnectAttemptedRef.current = quickConnectIntegrationId;
    if (routeOrganizationOnlyIntegration(integration)) return;
    if (
      integration.authMode === "oauth" &&
      !(hasOrg && supportsMcpIntegrationOrganizationScope(integration))
    ) {
      openForm(integration, { scope: "user" });
      return;
    }
    quickConnectRef.current?.(integration);
  }, [
    defaultIntegrations,
    hasOrg,
    mcpServersQuery.isError,
    mcpServersQuery.isSuccess,
    open,
    oauthReady,
    quickConnectIntegrationId,
  ]);

  useEffect(() => {
    if (!open || !connectIntegrationId) return;
    if (mcpServersQuery.isError) return;
    if (!mcpServersQuery.isSuccess) return;
    const integration = defaultIntegrations.find(
      (candidate) => candidate.id === connectIntegrationId,
    );
    if (!integration) return;
    if (integration.authMode === "oauth" && !oauthReady) return;
    const attemptKey = `connect:${connectIntegrationId}`;
    if (quickConnectAttemptedRef.current === attemptKey) return;
    quickConnectAttemptedRef.current = attemptKey;
    if (routeOrganizationOnlyIntegration(integration)) return;
    if (hasOrg && supportsMcpIntegrationOrganizationScope(integration)) {
      setSelected(integration);
      setMode("choice");
      return;
    }
    if (requiresMcpIntegrationSetup(integration)) {
      openForm(integration);
      return;
    }
    if (integration.authMode === "oauth") {
      openForm(integration, { scope: "user" });
      return;
    }
    quickConnectRef.current?.(integration);
  }, [
    canCreateOrgMcp,
    connectIntegrationId,
    defaultIntegrations,
    hasOrg,
    mcpServersQuery.isError,
    mcpServersQuery.isSuccess,
    open,
    oauthReady,
  ]);

  const connectPersonal = (integration: DefaultMcpIntegration) => {
    if (requiresMcpIntegrationSetup(integration)) {
      const apiFallback = getMcpIntegrationApiFallback(integration);
      if (apiFallback) {
        openAgentSettings(`secrets:${apiFallback.secretKey}`);
      } else {
        openForm(integration, { scope: "user" });
      }
      return;
    }
    if (integration.authMode === "oauth") {
      connectWithOAuth(integration, { scope: "user" });
      return;
    }
    if (
      integration.authMode === "none" &&
      integration.connectionMode === "direct"
    ) {
      void createServer({
        scope: "user",
        name: integration.name,
        url: integration.url,
        description: integration.description,
      });
      return;
    }
    openForm(integration, { scope: "user" });
  };

  const connectWorkspace = (integration: DefaultMcpIntegration) => {
    if (!canCreateOrgMcp) return;
    if (requiresMcpIntegrationSetup(integration)) {
      openForm(integration, { scope: "org" });
      return;
    }
    if (integration.authMode === "oauth") {
      connectWithOAuth(integration, { scope: "org" });
      return;
    }
    if (
      integration.authMode === "none" &&
      integration.connectionMode === "direct"
    ) {
      void createServer({
        scope: "org",
        name: integration.name,
        url: integration.url,
        description: integration.description,
      });
      return;
    }
    openForm(integration, { scope: "org" });
  };

  const runTest = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || busy) return;
    const validationError = getMcpUrlValidationError(trimmedUrl);
    if (validationError) {
      setTestResult({ ok: false, message: validationError });
      setError(null);
      return;
    }
    setBusy(true);
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await mcpApi.test(trimmedUrl, parseHeaderLines(headersText));
      setTestResult(
        res.ok
          ? {
              ok: true,
              message: t("mcpIntegrations.toolsAvailable", {
                count: res.toolCount ?? 0,
              }),
            }
          : { ok: false, message: res.error ?? t("mcpIntegrations.failed") },
      );
    } catch (err) {
      setTestResult({ ok: false, message: formatMcpServerError(err) });
    } finally {
      setBusy(false);
      setTesting(false);
    }
  };

  // The org-only rule covers the shared OAuth grant, so it applies to the OAuth
  // connection modes only. A header connection carries the user's own token and
  // stays legitimately personal, exactly as the server treats it.
  const formRequiresOrganizationScope = selected
    ? selected.authMode === "oauth" &&
      requiresMcpIntegrationOrganizationScope(selected)
    : customAuthMode === "oauth" && mcpUrlRequiresOrganizationScope(url);

  const renderScopeSelector = () => {
    if (selected?.managedOAuth) return null;
    // Offering a personal choice here would be a lie: the connection can only
    // be created for the workspace, so say that instead of showing a toggle.
    if (formRequiresOrganizationScope) {
      return (
        <p className="text-xs leading-5 text-muted-foreground">
          {t("mcpIntegrations.workspaceOnlyDescription")}
        </p>
      );
    }
    const canSelectScope = selected
      ? shouldOfferMcpIntegrationOrganizationScope(
          selected,
          hasOrg,
          canCreateOrgMcp,
        )
      : shouldOfferMcpOrganizationScope(hasOrg, canCreateOrgMcp);
    if (!canSelectScope) return null;

    return (
      <div className="grid gap-2">
        <span id={ids.scope} className="text-sm font-medium leading-none">
          {t("mcpIntegrations.scopeQuestion")}
        </span>
        <ToggleGroup
          type="single"
          variant="outline"
          value={scope}
          onValueChange={(value) => {
            if (value === "user" || value === "org") setScope(value);
          }}
          aria-labelledby={ids.scope}
          className="grid grid-cols-2"
        >
          <ToggleGroupItem value="user">
            {t("mcpIntegrations.personal")}
          </ToggleGroupItem>
          <ToggleGroupItem value="org">
            {t("mcpIntegrations.sharedWithWorkspace")}
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs leading-5 text-muted-foreground">
          {t(
            scope === "user"
              ? "mcpIntegrations.personalDescription"
              : "mcpIntegrations.organizationDescription",
          )}
        </p>
      </div>
    );
  };

  const primaryAction = selectedRequiresSetup
    ? selected?.authMode === "oauth"
      ? {
          run: () => connectWithOAuth(selected),
          disabled: !oauthReady || busy,
          label: t("mcpIntegrations.continueToConnect"),
        }
      : null
    : selected?.authMode === "oauth" ||
        (!selected && customAuthMode === "oauth")
      ? {
          run: selected ? connectSelectedWithOAuth : connectCustomWithOAuth,
          disabled: !oauthReady || !name.trim() || !url.trim() || busy,
          label: t("mcpIntegrations.connectWithOAuth"),
        }
      : {
          run: submitForm,
          disabled: !name.trim() || !url.trim() || busy,
          label: t("mcpIntegrations.connect"),
        };

  const submitPrimary = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!primaryAction || primaryAction.disabled) return;
    if (!selectedRequiresSetup) {
      const validationError = getMcpUrlValidationError(url.trim());
      if (validationError) {
        setUrlError(validationError);
        setTestResult(null);
        return;
      }
    }
    primaryAction.run();
  };

  if (!showCatalog && !customIntegrationEnabled) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          presentation === "takeover"
            ? "inset-0 h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 rounded-none"
            : "max-h-[min(680px,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-xl rounded-xl",
        )}
      >
        {mcpServersQuery.isError ? (
          <Alert
            variant="destructive"
            className="mx-7 mt-4 w-auto shrink-0 sm:mx-10"
          >
            <IconAlertCircle aria-hidden="true" />
            <AlertDescription className="flex flex-col items-start gap-2">
              <p>{formatMcpServersLoadError(mcpServersQuery.error)}</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void mcpServersQuery.refetch()}
                disabled={mcpServersQuery.isFetching}
              >
                {mcpServersQuery.isFetching
                  ? t("mcpIntegrations.retrying")
                  : t("mcpIntegrations.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {mode === "choice" && selected ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>
                {t("mcpIntegrations.connect")} {selected.name}
              </DialogTitle>
            </DialogHeader>
            <IntegrationConnectionChoice
              name={selected.name}
              logo={
                <McpIntegrationLogo
                  name={selected.name}
                  logoUrl={selected.logoUrl}
                  integrationId={selected.id}
                  className="size-7 rounded-md"
                  imageClassName="size-full p-1"
                />
              }
              showPersonalOption={allowsMcpIntegrationPersonalScope(selected)}
              showWorkspaceOption={supportsMcpIntegrationOrganizationScope(
                selected,
              )}
              workspaceOptionDisabled={!canCreateOrgMcp}
              workspaceOptionDisabledReason={
                !canCreateOrgMcp
                  ? t(
                      hasOrg
                        ? "mcpIntegrations.workspaceAdminRequired"
                        : "mcpIntegrations.workspaceJoinRequired",
                    )
                  : undefined
              }
              personalOnlyReason={
                !supportsMcpIntegrationOrganizationScope(selected)
                  ? t("mcpIntegrations.personalOnlyDescription")
                  : undefined
              }
              workspaceOnlyReason={
                requiresMcpIntegrationOrganizationScope(selected)
                  ? t("mcpIntegrations.workspaceOnlyDescription")
                  : undefined
              }
              busy={busy}
              compact={presentation === "modal"}
              onPersonal={() => connectPersonal(selected)}
              onWorkspace={() => connectWorkspace(selected)}
            />
          </>
        ) : mode === "catalog" ? (
          <>
            <DialogHeader className="shrink-0 px-7 pb-5 pe-14 pt-7 sm:px-10">
              <DialogTitle>{t("mcpIntegrations.title")}</DialogTitle>
              <DialogDescription>
                {t("mcpIntegrations.description", {
                  count: defaultIntegrations.length,
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="shrink-0 px-7 pb-5 sm:px-10">
              <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 sm:flex-row">
                <InputGroup className="min-w-0 flex-1">
                  <InputGroupInput
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("mcpIntegrations.searchPlaceholder")}
                  />
                  <InputGroupAddon>
                    <IconSearch aria-hidden="true" />
                  </InputGroupAddon>
                </InputGroup>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => openForm(null)}
                  className={cn(!customIntegrationEnabled && "hidden")}
                >
                  {t("mcpIntegrations.addYourOwn")}
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-10 pt-7 sm:px-10">
              <div className="mx-auto grid w-full max-w-5xl gap-3">
                {error ? (
                  <Alert variant="destructive">
                    <IconAlertCircle aria-hidden="true" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                {!mcpServersQuery.isSuccess && !mcpServersQuery.isError ? (
                  <p
                    role="status"
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    <Spinner aria-hidden="true" />
                    {t("mcpIntegrations.loadingScopeMetadata")}
                  </p>
                ) : null}
                <IntegrationGrid
                  items={filteredIntegrations.map((integration) => {
                    const connected = connectedServers.some((server) =>
                      isMcpIntegrationUrl(integration, server.url),
                    );
                    const setupOnly = requiresMcpIntegrationSetup(integration);
                    const apiFallback =
                      getMcpIntegrationApiFallback(integration);
                    return {
                      id: integration.id,
                      name: integration.name,
                      description: t(integration.descriptionKey),
                      logo: (
                        <McpIntegrationLogo
                          name={integration.name}
                          logoUrl={integration.logoUrl}
                          integrationId={integration.id}
                          className="size-7 rounded-md"
                          imageClassName="size-full p-1"
                        />
                      ),
                      status: connected
                        ? t("mcpIntegrations.connected")
                        : setupOnly
                          ? t("mcpIntegrations.status.setupRequired")
                          : undefined,
                      statusClassName: connected
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground",
                      actionLabel: connected
                        ? "Manage"
                        : setupOnly && apiFallback
                          ? t("mcpIntegrations.useApiToken")
                          : setupOnly
                            ? t("mcpIntegrations.viewSetup")
                            : t("mcpIntegrations.connect"),
                      disabled: connected || busy || !mcpServersQuery.isSuccess,
                      onAction: () => {
                        if (connected) {
                          openForm(integration);
                          return;
                        }
                        selectCatalogConnection(integration);
                      },
                    };
                  })}
                  emptyLabel={t("mcpIntegrations.noMatches")}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader
              className={cn(
                "shrink-0 border-b border-border pe-14",
                presentation === "takeover"
                  ? "px-7 pb-5 pt-7 sm:px-10"
                  : "px-6 pb-4 pt-6",
              )}
            >
              {showCatalog && presentation === "takeover" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    clearFeedback();
                    setMode("catalog");
                  }}
                  className="-ms-2 mb-1 self-start"
                >
                  <IconArrowLeft
                    aria-hidden="true"
                    className="rtl:-scale-x-100"
                  />
                  {t("mcpIntegrations.backToIntegrations")}
                </Button>
              ) : null}
              <DialogTitle>
                {selected
                  ? selectedRequiresSetup
                    ? t("mcpIntegrations.setupTitle", {
                        name: selected.name,
                      })
                    : t("mcpIntegrations.configureTitle", {
                        name: selected.name,
                      })
                  : t("mcpIntegrations.customTitle")}
              </DialogTitle>
              <DialogDescription>
                {selected
                  ? selectedRequiresSetup
                    ? t("mcpIntegrations.providerSetupFormDescription")
                    : selected.authMode === "none"
                      ? t("mcpIntegrations.presetNoAuthDescription")
                      : t("mcpIntegrations.presetAuthDescription")
                  : t("mcpIntegrations.customDescription")}
              </DialogDescription>
            </DialogHeader>
            <form
              noValidate
              onSubmit={submitPrimary}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div
                className={cn(
                  "min-h-0 flex-1 overflow-y-auto",
                  presentation === "takeover"
                    ? "px-7 py-7 sm:px-10"
                    : "px-6 py-5",
                )}
              >
                <div className="mx-auto grid max-w-2xl gap-5">
                  {renderScopeSelector()}
                  {selected?.setupNoteKey && !selectedRequiresSetup ? (
                    <p className="text-xs leading-5 text-muted-foreground">
                      {t(selected.setupNoteKey)}
                    </p>
                  ) : null}
                  {selectedRequiresSetup && selected && (
                    <div
                      className={cn(
                        "mx-auto grid w-full max-w-xl gap-4",
                        presentation === "takeover" ? "py-8" : "py-1",
                      )}
                    >
                      {presentation === "takeover" ? (
                        <div>
                          <p className="text-base font-semibold tracking-[-0.02em] text-foreground">
                            {t("mcpIntegrations.providerSetupRequired")}
                          </p>
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">
                            {t("mcpIntegrations.providerSetupDescription", {
                              name: selected.name,
                            })}
                          </p>
                        </div>
                      ) : null}
                      {selected.setupNoteKey ? (
                        <p className="text-sm leading-6 text-muted-foreground">
                          {t(selected.setupNoteKey)}
                        </p>
                      ) : null}
                      <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {t("mcpIntegrations.personalConnection")}
                          </p>
                          <p className="text-xs leading-5 text-muted-foreground">
                            {t("mcpIntegrations.personalDescription")}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t("mcpIntegrations.personal")}
                        </span>
                      </div>
                      {selected.docsUrl ? (
                        <a
                          href={selected.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex w-fit items-center gap-1 text-sm font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
                        >
                          {t("mcpIntegrations.viewSetup")}
                          <IconExternalLink
                            aria-hidden="true"
                            className="size-3.5"
                          />
                        </a>
                      ) : null}
                    </div>
                  )}
                  {!selected && (
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">
                        {customAuthMode === "oauth"
                          ? t(
                              /* i18n-key-ignore */
                              "mcpIntegrations.customOAuthDefault",
                              { defaultValue: "Sign in with OAuth" },
                            )
                          : t(
                              /* i18n-key-ignore */
                              "mcpIntegrations.customHeadersMode",
                              { defaultValue: "Use an API key" },
                            )}
                      </span>
                      <Button
                        type="button"
                        variant="link"
                        size="xs"
                        onClick={() => {
                          setCustomAuthMode((current) =>
                            current === "oauth" ? "headers" : "oauth",
                          );
                          clearFeedback();
                        }}
                      >
                        {customAuthMode === "oauth"
                          ? t(
                              /* i18n-key-ignore */
                              "mcpIntegrations.useApiKeyInstead",
                              { defaultValue: "Use an API key instead" },
                            )
                          : t(
                              /* i18n-key-ignore */
                              "mcpIntegrations.useOAuthInstead",
                              { defaultValue: "Use OAuth instead" },
                            )}
                      </Button>
                    </div>
                  )}
                  {!selectedRequiresSetup && (
                    <>
                      {selected?.authMode === "oauth" && (
                        <Alert>
                          <AlertDescription>
                            {t("mcpIntegrations.oauthNotice")}
                          </AlertDescription>
                        </Alert>
                      )}
                      <div className="grid gap-2">
                        <Label htmlFor={ids.name}>
                          {t("mcpIntegrations.serverName")}
                        </Label>
                        <Input
                          id={ids.name}
                          ref={inputRef}
                          value={name}
                          onChange={(event) => {
                            setName(event.target.value);
                            clearFeedback();
                          }}
                          placeholder={t(
                            "mcpIntegrations.serverNamePlaceholder",
                          )}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor={ids.url}>
                          {t("mcpIntegrations.url")}
                        </Label>
                        <Input
                          id={ids.url}
                          type="url"
                          value={url}
                          onChange={(event) => {
                            setUrl(event.target.value);
                            clearFeedback();
                          }}
                          aria-invalid={urlError ? true : undefined}
                          aria-describedby={urlError ? ids.urlError : undefined}
                          placeholder={t("mcpIntegrations.urlPlaceholder")}
                        />
                        {urlError ? (
                          <p
                            id={ids.urlError}
                            className="text-xs leading-5 text-destructive"
                          >
                            {urlError}
                          </p>
                        ) : null}
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor={ids.description}>
                          {t("mcpIntegrations.fieldDescription")}
                        </Label>
                        <Input
                          id={ids.description}
                          value={description}
                          onChange={(event) => {
                            setDescription(event.target.value);
                            clearFeedback();
                          }}
                          placeholder={t(
                            "mcpIntegrations.descriptionPlaceholder",
                          )}
                        />
                      </div>
                      {(selected
                        ? selected.authMode !== "oauth"
                        : customAuthMode === "headers") && (
                        <div className="grid gap-2">
                          <Label htmlFor={ids.headers}>
                            {t("mcpIntegrations.headers")}
                          </Label>
                          <Textarea
                            id={ids.headers}
                            value={headersText}
                            onChange={(event) => {
                              setHeadersText(event.target.value);
                              clearFeedback();
                            }}
                            rows={3}
                            className="resize-y font-mono"
                            placeholder={
                              selected?.headerPlaceholder ??
                              t("mcpIntegrations.headersPlaceholder")
                            }
                          />
                        </div>
                      )}
                      {selected?.docsUrl && (
                        <a
                          href={selected.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex w-fit items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline"
                        >
                          {t("mcpIntegrations.openSetupDocs")}
                          <IconExternalLink
                            aria-hidden="true"
                            className="size-3.5"
                          />
                        </a>
                      )}
                    </>
                  )}
                  {testResult ? (
                    testResult.ok ? (
                      <Alert role="status">
                        <IconCheck aria-hidden="true" />
                        <AlertDescription className="break-words">
                          {testResult.message}
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <Alert variant="destructive">
                        <IconAlertCircle aria-hidden="true" />
                        <AlertDescription className="break-words">
                          {testResult.message}
                        </AlertDescription>
                      </Alert>
                    )
                  ) : null}
                  {error ? (
                    <Alert variant="destructive">
                      <IconAlertCircle aria-hidden="true" />
                      <AlertDescription className="break-words">
                        {error}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </div>
              </div>
              <DialogFooter
                className={cn(
                  "shrink-0 gap-2 border-t border-border py-4 sm:space-x-0",
                  presentation === "takeover" ? "px-7" : "px-6",
                )}
              >
                {!selectedRequiresSetup && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={runTest}
                    disabled={!url.trim() || busy}
                    aria-busy={testing || undefined}
                    className="sm:me-auto"
                  >
                    {testing ? <Spinner aria-hidden="true" /> : null}
                    {t("mcpIntegrations.test")}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onOpenChange(false)}
                >
                  {t("common.cancel")}
                </Button>
                {primaryAction ? (
                  <Button
                    type="submit"
                    disabled={primaryAction.disabled}
                    aria-busy={(busy && !testing) || undefined}
                  >
                    {busy && !testing ? <Spinner aria-hidden="true" /> : null}
                    {primaryAction.label}
                  </Button>
                ) : null}
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
