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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
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
  type DefaultMcpIntegration,
} from "./mcp-integration-catalog.js";
import {
  formatMcpServerError,
  getMcpUrlValidationError,
  testMcpServerUrl,
  useMcpServers,
  type CreateMcpServerArgs,
  type McpServerScope,
} from "./use-mcp-servers.js";

type DialogMode = "catalog" | "form";

export interface McpIntegrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialIntegrationId?: string | null;
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

function IntegrationLogo({ name, logoUrl }: { name: string; logoUrl: string }) {
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setLoadFailed(false);
  }, [logoUrl]);

  return (
    <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background text-[11px] font-semibold text-muted-foreground">
      <span aria-hidden="true" hidden={loaded}>
        {name.slice(0, 1)}
      </span>
      <img
        src={logoUrl}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute inset-1 h-6 w-6 object-contain"
        hidden={loadFailed}
        onLoad={() => {
          setLoadFailed(false);
          setLoaded(true);
        }}
        onError={() => {
          setLoadFailed(true);
          setLoaded(false);
        }}
      />
    </div>
  );
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

export function McpIntegrationDialog({
  open,
  onOpenChange,
  initialIntegrationId = null,
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
  const [quickBusyId, setQuickBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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
    selected &&
    (selected.connectionMode === "manual" ||
      selected.availability === "provider-setup" ||
      selected.availability === "client-restricted"),
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
    setScope(safeDefaultScope);
    setName(initialDefaults.name);
    setUrl(initialDefaults.url);
    setDescription(initialDefaults.description);
    setHeadersText(initialDefaults.headersText);
    setBusy(false);
    setQuickBusyId(null);
    setError(null);
    setTestResult(null);
  }, [
    defaultIntegrations,
    initialIntegrationId,
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

  const openForm = (integration?: DefaultMcpIntegration | null) => {
    const defaults = createMcpIntegrationFormDefaults(integration);
    setSelected(integration ?? null);
    setScope(safeDefaultScope);
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
    options?: { quickId?: string },
  ) => {
    const validationError = getMcpUrlValidationError(args.url);
    if (validationError) {
      setError(validationError);
      setTestResult(null);
      return;
    }
    setBusy(true);
    setQuickBusyId(options?.quickId ?? null);
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
          scope: safeDefaultScope,
          returnUrl,
        }),
      ),
    );
  };

  const connectWithOAuth = (
    integration: DefaultMcpIntegration,
    options?: { quickId?: string },
  ) =>
    beginOAuth(
      {
        name: integration.name,
        url: integration.url,
        description: integration.description,
      },
      options,
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

  const createServer = async (
    args: CreateMcpServerArgs,
    options?: { quickId?: string },
  ) => {
    const validationError = getMcpUrlValidationError(args.url);
    if (validationError) {
      setError(validationError);
      setTestResult(null);
      return;
    }

    if (options?.quickId) setQuickBusyId(options.quickId);
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
      setQuickBusyId(null);
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
    if (
      integration.connectionMode === "manual" ||
      integration.availability === "provider-setup"
    ) {
      return;
    }
    if (integration.authMode === "oauth") {
      connectWithOAuth(integration, { quickId: integration.id });
      return;
    }
    if (integration.authMode === "headers") {
      openForm(integration);
      return;
    }
    void createServer(
      {
        scope: safeDefaultScope,
        name: integration.name,
        url: integration.url,
        description: integration.description,
      },
      { quickId: integration.id },
    );
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
      const res = await testMcpServerUrl(
        trimmedUrl,
        parseHeaderLines(headersText),
      );
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
    const orgTooltip = !hasOrg
      ? t("mcpIntegrations.orgNoOrg")
      : !canCreateOrgMcp
        ? t("mcpIntegrations.orgAdminOnly")
        : null;

    return (
      <div className="flex gap-1 rounded-md border border-border bg-background p-0.5">
        <button
          type="button"
          onClick={() => setScope("user")}
          className={cn(
            "flex-1 rounded px-2 py-1.5 text-[11px] font-medium",
            scope === "user"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t("mcpIntegrations.personal")}
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => hasOrg && canCreateOrgMcp && setScope("org")}
              disabled={!hasOrg || !canCreateOrgMcp}
              className={cn(
                "flex-1 rounded px-2 py-1.5 text-[11px] font-medium",
                scope === "org"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
                (!hasOrg || !canCreateOrgMcp) &&
                  "cursor-not-allowed opacity-50 hover:text-muted-foreground",
              )}
            >
              {t("mcpIntegrations.organization")}
            </button>
          </TooltipTrigger>
          {orgTooltip && <TooltipContent>{orgTooltip}</TooltipContent>}
        </Tooltip>
      </div>
    );
  };

  if (!showCatalog && !customIntegrationEnabled) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(820px,calc(100vh-32px))] w-[calc(100vw-24px)] max-w-[760px] flex-col gap-0 p-0 sm:w-[min(760px,calc(100vw-48px))]">
        {mode === "catalog" ? (
          <>
            <DialogHeader className="shrink-0 px-7 pb-5 pe-14 pt-6">
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
            <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-7">
              {error && (
                <div className="mb-3 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] leading-relaxed text-red-600 dark:text-red-400">
                  {error}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {filteredIntegrations.map((integration) => {
                  const apiFallback = getMcpIntegrationApiFallback(integration);
                  const connected = connectedUrls.has(
                    compareUrl(integration.url),
                  );
                  const requiresHeaders = integration.authMode === "headers";
                  const setupOnly =
                    integration.connectionMode === "manual" ||
                    integration.availability === "provider-setup" ||
                    integration.availability === "client-restricted";
                  return (
                    <article
                      key={integration.id}
                      className="flex min-h-[128px] flex-col rounded-md border border-border bg-card p-4 transition-colors hover:border-border/80 hover:bg-accent/20"
                    >
                      <div className="flex items-center gap-3">
                        <IntegrationLogo
                          name={integration.name}
                          logoUrl={integration.logoUrl}
                        />
                        <div className="min-w-0">
                          <h3 className="truncate text-[13px] font-semibold text-foreground">
                            {integration.name}
                          </h3>
                          {integration.availability !== "ready" && (
                            <span className="mt-0.5 inline-flex rounded-full border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                              {integration.availability === "beta"
                                ? t("mcpIntegrations.status.beta")
                                : integration.availability ===
                                    "client-restricted"
                                  ? t("mcpIntegrations.status.clientRestricted")
                                  : t("mcpIntegrations.status.setupRequired")}
                            </span>
                          )}
                          <span className="ms-1 mt-0.5 inline-flex rounded-full border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                            {integration.verification === "verified"
                              ? t("mcpIntegrations.status.verified")
                              : integration.verification === "restricted"
                                ? t("mcpIntegrations.status.restricted")
                                : t("mcpIntegrations.status.preflightOnly")}
                          </span>
                        </div>
                      </div>
                      <p className="mt-1 line-clamp-2 flex-1 text-[12px] leading-relaxed text-muted-foreground">
                        {t(integration.descriptionKey)}
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        {connected ? (
                          <button
                            type="button"
                            disabled
                            className="inline-flex h-8 flex-1 cursor-not-allowed items-center justify-center gap-1.5 rounded-md border border-border bg-muted px-2.5 text-[12px] font-medium text-muted-foreground opacity-70"
                          >
                            {t("mcpIntegrations.connected")}
                          </button>
                        ) : setupOnly ? (
                          <>
                            {apiFallback && (
                              <button
                                type="button"
                                onClick={() =>
                                  openAgentSettings(
                                    `secrets:${apiFallback.secretKey}`,
                                  )
                                }
                                className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
                              >
                                {t("mcpIntegrations.useApiToken")}
                              </button>
                            )}
                            <a
                              href={integration.docsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[12px] font-medium text-foreground hover:bg-accent"
                            >
                              {t("mcpIntegrations.viewSetup")}
                              <IconExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => quickConnect(integration)}
                            disabled={busy}
                            aria-busy={quickBusyId === integration.id}
                            className={cn(
                              "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90",
                              busy && "cursor-not-allowed opacity-70",
                            )}
                          >
                            {quickBusyId === integration.id ? (
                              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            {integration.authMode === "oauth"
                              ? t("mcpIntegrations.connectWithOAuth")
                              : requiresHeaders
                                ? t("mcpIntegrations.configure")
                                : t("mcpIntegrations.connect")}
                          </button>
                        )}
                        {integration.docsUrl && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <a
                                href={integration.docsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                                aria-label={t("mcpIntegrations.docsLabel", {
                                  name: integration.name,
                                })}
                              >
                                <IconExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("mcpIntegrations.docsLabel", {
                                name: integration.name,
                              })}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
              {filteredIntegrations.length === 0 && (
                <div className="rounded-md border border-dashed border-border p-6 text-center text-[12px] text-muted-foreground">
                  {t("mcpIntegrations.noMatches")}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="shrink-0 border-b border-border px-7 pb-5 pe-14 pt-6">
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
                  ? t("mcpIntegrations.configureTitle", {
                      name: selected.name,
                    })
                  : t("mcpIntegrations.customTitle")}
              </DialogTitle>
              <DialogDescription>
                {selected
                  ? selected.authMode === "none"
                    ? t("mcpIntegrations.presetNoAuthDescription")
                    : t("mcpIntegrations.presetAuthDescription")
                  : t("mcpIntegrations.customDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5">
              <div className="space-y-3">
                {renderScopeSelector()}
                {selected?.setupNoteKey && (
                  <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                    {t(selected.setupNoteKey)}
                  </div>
                )}
                {selected?.authMode === "oauth" && (
                  <div className="rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-[11px] leading-relaxed text-blue-700 dark:text-blue-300">
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
                    placeholder={t("mcpIntegrations.descriptionPlaceholder")}
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
              <button
                type="button"
                onClick={runTest}
                disabled={!url.trim() || busy}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
              >
                {t("mcpIntegrations.test")}
              </button>
              {selected?.authMode === "oauth" && !selectedRequiresSetup ? (
                <button
                  type="button"
                  onClick={() => connectWithOAuth(selected)}
                  disabled={!name.trim() || !url.trim() || busy}
                  aria-busy={busy}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
                >
                  {busy && (
                    <IconLoader2 className="me-1.5 inline h-3.5 w-3.5 animate-spin" />
                  )}
                  {t("mcpIntegrations.connectWithOAuth")}
                </button>
              ) : !selected ? (
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
                selected?.docsUrl ? (
                  <a
                    href={selected.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-w-[92px] items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    {t("mcpIntegrations.viewSetup")}
                    <IconExternalLink className="h-3 w-3" />
                  </a>
                ) : null
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
