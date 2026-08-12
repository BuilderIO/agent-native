import {
  IconArrowLeft,
  IconCheck,
  IconExternalLink,
  IconLoader2,
  IconSearch,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { agentNativePath } from "../api-path.js";
import { openAgentSettings } from "../CommandMenu.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { useT } from "../i18n.js";
import { IntegrationConnectionChoice } from "../integrations/IntegrationConnectionChoice.js";
import { IntegrationGrid } from "../integrations/IntegrationGrid.js";
import { cn } from "../utils.js";
import {
  buildMcpOAuthStartUrl,
  createMcpIntegrationFormDefaults,
  filterMcpIntegrations,
  getMcpIntegrationApiFallback,
  getDefaultMcpIntegrations,
  isCustomMcpIntegrationEnabled,
  navigateToMcpOAuthStart,
  resolveMcpIntegrationScope,
  shouldOfferMcpIntegrationOrganizationScope,
  shouldOfferMcpOrganizationScope,
  type DefaultMcpIntegration,
} from "./mcp-integration-catalog.js";
import { McpIntegrationLogo } from "./McpIntegrationLogo.js";
import {
  formatMcpServerError,
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
  defaultScope: McpServerScope;
  canCreateOrgMcp: boolean;
  hasOrg: boolean;
  onCreateMcpServer: (args: CreateMcpServerArgs) => Promise<unknown>;
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

function compareUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
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
    defaultScope,
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
  defaultScope,
  canCreateOrgMcp,
  hasOrg,
  onCreateMcpServer,
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const quickConnectAttemptedRef = useRef<string | null>(null);
  const quickConnectRef = useRef<
    ((integration: DefaultMcpIntegration) => void) | null
  >(null);
  const mcpApi = useMcpServersApi();
  const mcpServersQuery = useMcpServers();
  const defaultIntegrations = useMemo(
    () => integrations ?? getDefaultMcpIntegrations(),
    [integrations],
  );
  const customIntegrationEnabled = useMemo(
    () => isCustomMcpIntegrationEnabled(),
    [],
  );
  const showCatalog = defaultIntegrations.length > 0;

  const connectedUrls = useMemo(() => {
    const servers = [
      ...(mcpServersQuery.data?.user ?? []),
      ...(mcpServersQuery.data?.org ?? []),
    ];
    // A saved server is not necessarily a working connection. The settings
    // page reports failed and unknown health states separately, so only mark
    // catalog entries as connected after the health probe succeeds.
    return new Set(
      servers
        .filter((server) => server.status.state === "connected")
        .map((server) => compareUrl(server.url)),
    );
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
    const initialIntegration = initialIntegrationId
      ? defaultIntegrations.find(
          (integration) => integration.id === initialIntegrationId,
        )
      : null;
    const initialDefaults =
      createMcpIntegrationFormDefaults(initialIntegration);
    setMode(initialIntegration || !showCatalog ? "form" : "catalog");
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
    setBusy(false);
    setError(null);
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
  ]);

  useEffect(() => {
    if (open && mode === "form") {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(timer);
    }
  }, [mode, open]);

  const clearFeedback = () => {
    setError(null);
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
    setError(null);
    setTestResult(null);
    setMode("form");
  };

  const beginOAuth = (
    args: {
      name: string;
      url: string;
      description: string;
    },
    options?: { scope?: McpServerScope },
  ) => {
    const validationError = getMcpUrlValidationError(args.url);
    if (validationError) {
      setError(validationError);
      setTestResult(null);
      return;
    }
    setBusy(true);
    const returnUrl =
      typeof window === "undefined"
        ? "/"
        : window.location.pathname +
          window.location.search +
          window.location.hash;
    navigateToMcpOAuthStart(
      agentNativePath(
        buildMcpOAuthStartUrl({
          name: args.name,
          url: args.url,
          description: args.description,
          scope: options?.scope ?? scope,
          returnUrl,
        }),
      ),
    );
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

  const quickConnect = (integration: DefaultMcpIntegration) => {
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
    if (requiresMcpIntegrationSetup(integration)) {
      const apiFallback = getMcpIntegrationApiFallback(integration);
      if (apiFallback) {
        openAgentSettings(`secrets:${apiFallback.secretKey}`);
      } else {
        openForm(integration);
      }
      return;
    }
    if (
      shouldOfferMcpIntegrationOrganizationScope(
        integration,
        hasOrg,
        canCreateOrgMcp,
      )
    ) {
      setSelected(integration);
      setMode("choice");
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
    const integration = defaultIntegrations.find(
      (candidate) => candidate.id === quickConnectIntegrationId,
    );
    if (!integration) return;
    quickConnectAttemptedRef.current = quickConnectIntegrationId;
    quickConnectRef.current?.(integration);
  }, [defaultIntegrations, open, quickConnectIntegrationId]);

  useEffect(() => {
    if (!open || !connectIntegrationId) return;
    const integration = defaultIntegrations.find(
      (candidate) => candidate.id === connectIntegrationId,
    );
    if (!integration) return;
    const attemptKey = `connect:${connectIntegrationId}`;
    if (quickConnectAttemptedRef.current === attemptKey) return;
    quickConnectAttemptedRef.current = attemptKey;
    if (requiresMcpIntegrationSetup(integration)) {
      openForm(integration);
      return;
    }
    const showWorkspaceChoice = shouldOfferMcpIntegrationOrganizationScope(
      integration,
      hasOrg,
      canCreateOrgMcp,
    );
    if (!showWorkspaceChoice) {
      quickConnectRef.current?.(integration);
    } else {
      setMode("choice");
    }
  }, [
    canCreateOrgMcp,
    connectIntegrationId,
    defaultIntegrations,
    hasOrg,
    open,
  ]);

  const connectPersonal = (integration: DefaultMcpIntegration) => {
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
    }
  };

  const renderScopeSelector = () => {
    if (selected?.managedOAuth) return null;
    const canSelectScope = selected
      ? shouldOfferMcpIntegrationOrganizationScope(
          selected,
          hasOrg,
          canCreateOrgMcp,
        )
      : shouldOfferMcpOrganizationScope(hasOrg, canCreateOrgMcp);
    if (!canSelectScope) return null;

    return (
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-foreground">
          {t("mcpIntegrations.scopeQuestion")}
        </p>
        <div className="flex gap-1 rounded-md border border-border bg-background p-0.5">
          <button
            type="button"
            onClick={() => setScope("user")}
            aria-pressed={scope === "user"}
            className={cn(
              "flex-1 rounded px-2 py-1.5 text-[11px] font-medium",
              scope === "user"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("mcpIntegrations.personal")}
          </button>
          <button
            type="button"
            onClick={() => setScope("org")}
            aria-pressed={scope === "org"}
            className={cn(
              "flex-1 rounded px-2 py-1.5 text-[11px] font-medium",
              scope === "org"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("mcpIntegrations.sharedWithWorkspace")}
          </button>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t(
            scope === "user"
              ? "mcpIntegrations.personalDescription"
              : "mcpIntegrations.organizationDescription",
          )}
        </p>
      </div>
    );
  };

  if (!showCatalog && !customIntegrationEnabled) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="inset-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0">
        {mode === "choice" && selected ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>Connect {selected.name}</DialogTitle>
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
              showWorkspaceOption={shouldOfferMcpIntegrationOrganizationScope(
                selected,
                hasOrg,
                canCreateOrgMcp,
              )}
              busy={busy}
              onPersonal={() => connectPersonal(selected)}
              onWorkspace={() => connectWorkspace(selected)}
            />
          </>
        ) : mode === "catalog" ? (
          <>
            <DialogHeader className="shrink-0 border-b border-border px-7 pb-5 pe-14 pt-7 sm:px-10">
              <DialogTitle>{t("mcpIntegrations.title")}</DialogTitle>
              <DialogDescription>
                {t("mcpIntegrations.description", {
                  count: defaultIntegrations.length,
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="flex shrink-0 flex-col gap-3 px-7 pb-5 sm:flex-row">
              <label className="relative min-w-0 flex-1">
                <IconSearch className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-background pe-3 ps-8 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-ring"
                  placeholder={t("mcpIntegrations.searchPlaceholder")}
                />
              </label>
              <button
                type="button"
                onClick={() => openForm(null)}
                className={cn(
                  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-[12px] font-medium text-foreground hover:bg-accent",
                  !customIntegrationEnabled && "hidden",
                )}
              >
                {t("mcpIntegrations.addYourOwn")}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-10 pt-7 sm:px-10">
              <div className="mx-auto w-full max-w-5xl">
                {error && (
                  <div className="mb-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[12px] leading-relaxed text-destructive">
                    {error}
                  </div>
                )}
                <IntegrationGrid
                  items={filteredIntegrations.map((integration) => {
                  const connected = connectedUrls.has(
                    compareUrl(integration.url),
                  );
                  const setupOnly = requiresMcpIntegrationSetup(integration);
                  const apiFallback = getMcpIntegrationApiFallback(integration);
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
                    disabled: connected || busy,
                    onAction: () => {
                      if (connected) {
                        openForm(integration);
                        return;
                      }
                      selectCatalogConnection(integration);
                    },
                  };
                  })}
                />
                {filteredIntegrations.length === 0 && (
                  <div className="rounded-md border border-dashed border-border p-6 text-center text-[12px] text-muted-foreground">
                    {t("mcpIntegrations.noMatches")}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="shrink-0 border-b border-border px-7 pb-5 pe-14 pt-7 sm:px-10">
              <button
                type="button"
                onClick={() => {
                  clearFeedback();
                  setMode("catalog");
                }}
                className={cn(
                  "mb-1 inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground",
                  !showCatalog && "hidden",
                )}
              >
                <IconArrowLeft className="h-3 w-3 rtl:-scale-x-100" />
                {t("mcpIntegrations.backToIntegrations")}
              </button>
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
            <div className="min-h-0 flex-1 overflow-y-auto px-7 py-7 sm:px-10">
              <div className="mx-auto max-w-2xl space-y-3">
                {renderScopeSelector()}
                {selected?.setupNoteKey && !selectedRequiresSetup ? (
                  <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                    {t(selected.setupNoteKey)}
                  </div>
                ) : null}
                {selectedRequiresSetup && selected && (
                  <div className="mx-auto grid w-full max-w-xl gap-4 py-8">
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
                    {selected.setupNoteKey ? (
                      <p className="text-sm leading-6 text-muted-foreground">
                        {t(selected.setupNoteKey)}
                      </p>
                    ) : null}
                    {selected.docsUrl ? (
                      <a
                        href={selected.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex w-fit items-center gap-1 text-sm font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
                      >
                        {t("mcpIntegrations.viewSetup")}
                        <IconExternalLink className="size-3.5" />
                      </a>
                    ) : null}
                  </div>
                )}
                {!selectedRequiresSetup && (
                  <>
                    {selected?.authMode === "oauth" && (
                      <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] leading-relaxed text-primary">
                        {t("mcpIntegrations.oauthNotice")}
                      </div>
                    )}
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-medium text-muted-foreground">
                        {t("mcpIntegrations.serverName")}
                      </span>
                      <input
                        ref={inputRef}
                        value={name}
                        onChange={(event) => {
                          setName(event.target.value);
                          clearFeedback();
                        }}
                        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-ring"
                        placeholder={t("mcpIntegrations.serverNamePlaceholder")}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-medium text-muted-foreground">
                        {t("mcpIntegrations.url")}
                      </span>
                      <input
                        value={url}
                        onChange={(event) => {
                          setUrl(event.target.value);
                          clearFeedback();
                        }}
                        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-ring"
                        placeholder={t("mcpIntegrations.urlPlaceholder")}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-medium text-muted-foreground">
                        {t("mcpIntegrations.fieldDescription")}
                      </span>
                      <input
                        value={description}
                        onChange={(event) => {
                          setDescription(event.target.value);
                          clearFeedback();
                        }}
                        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-ring"
                        placeholder={t(
                          "mcpIntegrations.descriptionPlaceholder",
                        )}
                      />
                    </label>
                    {selected?.authMode !== "oauth" && (
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-medium text-muted-foreground">
                          {t("mcpIntegrations.headers")}
                        </span>
                        <textarea
                          value={headersText}
                          onChange={(event) => {
                            setHeadersText(event.target.value);
                            clearFeedback();
                          }}
                          rows={3}
                          className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-ring"
                          style={{
                            fontFamily:
                              'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                          }}
                          placeholder={
                            selected?.headerPlaceholder ??
                            t("mcpIntegrations.headersPlaceholder")
                          }
                        />
                      </label>
                    )}
                    {selected?.docsUrl && (
                      <a
                        href={selected.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline hover:text-foreground"
                      >
                        {t("mcpIntegrations.openSetupDocs")}
                        <IconExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </>
                )}
                {testResult && (
                  <div
                    className={cn(
                      "flex items-start gap-1 rounded-md px-3 py-2 text-[11px] leading-snug",
                      testResult.ok
                        ? "bg-green-500/5 text-green-600 dark:text-green-400"
                        : "bg-red-500/5 text-red-600 dark:text-red-400",
                    )}
                  >
                    {testResult.ok && (
                      <IconCheck className="mt-0.5 h-3 w-3 shrink-0" />
                    )}
                    <span className="min-w-0 break-words">
                      {testResult.message}
                    </span>
                  </div>
                )}
                {error && (
                  <div className="break-words rounded-md bg-red-500/5 px-3 py-2 text-[11px] leading-snug text-red-600 dark:text-red-400">
                    {error}
                  </div>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-7 py-4">
              {!selectedRequiresSetup && (
                <button
                  type="button"
                  onClick={runTest}
                  disabled={!url.trim() || busy}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
                >
                  {t("mcpIntegrations.test")}
                </button>
              )}
              {!selected ? (
                <button
                  type="button"
                  onClick={connectCustomWithOAuth}
                  disabled={!name.trim() || !url.trim() || busy}
                  aria-busy={busy}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
                >
                  {busy && (
                    <IconLoader2 className="me-1.5 inline h-3.5 w-3.5 animate-spin" />
                  )}
                  {t("mcpIntegrations.connectWithOAuth")}
                </button>
              ) : null}
              {selectedRequiresSetup ? (
                <div className="ms-auto flex items-center gap-2">
                  {selected?.docsUrl ? (
                    <a
                      href={selected.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-w-[92px] items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent"
                    >
                      {t("mcpIntegrations.viewSetup")}
                      <IconExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                  {selected?.authMode === "oauth" && (
                    <button
                      type="button"
                      onClick={() => connectWithOAuth(selected)}
                      disabled={busy}
                      aria-busy={busy}
                      className="inline-flex min-w-[132px] items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
                    >
                      {busy && (
                        <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      {t("mcpIntegrations.continueToConnect")}
                    </button>
                  )}
                </div>
              ) : selected?.authMode === "oauth" ? (
                <button
                  type="button"
                  onClick={() => connectWithOAuth(selected)}
                  disabled={!name.trim() || !url.trim() || busy}
                  aria-busy={busy}
                  className="inline-flex min-w-[92px] items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
                >
                  {busy && <IconLoader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t("mcpIntegrations.connectWithOAuth")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submitForm}
                  disabled={!name.trim() || !url.trim() || busy}
                  className="inline-flex min-w-[92px] items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
                >
                  {busy && <IconLoader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t("mcpIntegrations.connect")}
                </button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
