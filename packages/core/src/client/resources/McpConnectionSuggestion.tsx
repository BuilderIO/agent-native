import { IconLoader2, IconPlugConnected, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { openAgentSettings } from "../CommandMenu.js";
import { useT } from "../i18n.js";
import {
  clearMcpConnectionResume,
  notifyMcpConnectionComplete,
  saveMcpConnectionResume,
} from "./mcp-connection-resume.js";
import {
  findMcpIntegrationForText,
  getMcpIntegrationApiFallback,
  getDefaultMcpIntegrations,
  isMcpIntegrationUrl,
  isMcpConnectionFailureText,
  isMcpConnectionSuggestionText,
  type DefaultMcpIntegration,
} from "./mcp-integration-catalog.js";
import { McpIntegrationDialog } from "./McpIntegrationDialog.js";
import { McpIntegrationLogo } from "./McpIntegrationLogo.js";
import {
  useCreateMcpServer,
  useMcpServers,
  type McpServer,
} from "./use-mcp-servers.js";

export type McpConnectionSuggestionVariant = "composer" | "response";

export interface McpConnectionSuggestionProps {
  text: string;
  contextText?: string;
  variant?: McpConnectionSuggestionVariant;
  /**
   * Required when rendering an agent-authored connection request beside the
   * composer. User-authored composer text must never promote integrations.
   */
  requestedByAgent?: boolean;
  integrations?: DefaultMcpIntegration[];
  /** Trusted catalog identifier used by structured AgentKit requests. */
  integrationId?: string;
  onConnected?: () => void | Promise<void>;
  onDismiss?: () => void | Promise<void>;
  onOAuthStart?: (url: string) => void | Promise<void>;
}

const DISMISSED_MCP_SUGGESTIONS_STORAGE_KEY =
  "agent-native:mcp-connection-suggestions-dismissed";

function readDismissedMcpSuggestionIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(
      DISMISSED_MCP_SUGGESTIONS_STORAGE_KEY,
    );
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    // coercion-ok: unavailable browser storage means no persisted dismissals.
    return [];
  }
}

function rememberMcpSuggestionDismissal(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const ids = readDismissedMcpSuggestionIds();
    if (ids.includes(id)) return;
    window.localStorage.setItem(
      DISMISSED_MCP_SUGGESTIONS_STORAGE_KEY,
      JSON.stringify([...ids, id]),
    );
  } catch {
    // coercion-ok: unavailable browser storage only skips persistence.
    return;
  }
}

function visibleUserAuthoredText(text: string): string {
  return text
    .replace(/<context\b[^>]*>[\s\S]*?<\/context>\n?/gi, "")
    .replace(/<context\b[^>]*>[\s\S]*$/gi, "")
    .replace(/<\/context>/gi, "")
    .trim();
}

export function findMcpConnectionSuggestionIntegration({
  text,
  contextText = "",
  variant = "composer",
  requestedByAgent = false,
  integrations = getDefaultMcpIntegrations(),
  integrationId,
}: McpConnectionSuggestionProps): DefaultMcpIntegration | null {
  if (integrationId) {
    const normalized = integrationId.trim().toLowerCase();
    return (
      integrations.find(
        (integration) =>
          integration.id.toLowerCase() === normalized ||
          integration.provider.toLowerCase() === normalized,
      ) ?? null
    );
  }
  const responseText = visibleUserAuthoredText(text);
  if (variant !== "response") {
    if (!requestedByAgent) return null;
    if (
      !isMcpConnectionSuggestionText(responseText) &&
      !isMcpConnectionFailureText(responseText)
    ) {
      return null;
    }
  }

  // A completed response may itself be the agent's request for setup. Prefer
  // that provider, then fall back to the user's preceding provider mention for
  // responses such as "I can't access it yet - please connect it.".
  if (
    isMcpConnectionSuggestionText(responseText) ||
    isMcpConnectionFailureText(responseText)
  ) {
    return (
      findMcpIntegrationForText(responseText, integrations) ??
      findMcpIntegrationForText(
        visibleUserAuthoredText(contextText),
        integrations,
      )
    );
  }

  return null;
}

export function shouldRenderMcpIntegrationFallback(
  logoUrl: string,
  logoLoadFailed: boolean,
): boolean {
  return !logoUrl || logoLoadFailed;
}

function isConnected(
  integration: DefaultMcpIntegration,
  servers: McpServer[],
): boolean {
  return servers.some(
    (server) =>
      server.status.state === "connected" &&
      isMcpIntegrationUrl(integration, server.url),
  );
}

function hasApiFallback(
  apiFallback: DefaultMcpIntegration["apiFallback"] | null,
): boolean {
  return Boolean(apiFallback);
}

export function McpConnectionSuggestion({
  text,
  contextText = "",
  variant = "composer",
  requestedByAgent = false,
  integrations: integrationOptions,
  integrationId,
  onConnected,
  onDismiss,
  onOAuthStart,
}: McpConnectionSuggestionProps) {
  const t = useT();
  const mcpServersQuery = useMcpServers();
  const createMcpServer = useCreateMcpServer();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [quickConnectIntegrationId, setQuickConnectIntegrationId] = useState<
    string | null
  >(null);
  const [dismissedIds, setDismissedIds] = useState(
    readDismissedMcpSuggestionIds,
  );
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const oauthStartingRef = useRef(false);
  const integrations = useMemo(
    () => integrationOptions ?? getDefaultMcpIntegrations(),
    [integrationOptions],
  );
  const integration = useMemo(
    () =>
      findMcpConnectionSuggestionIntegration({
        text,
        contextText,
        variant,
        requestedByAgent,
        integrations,
        integrationId,
      }),
    [contextText, integrationId, integrations, requestedByAgent, text, variant],
  );
  const apiFallback = integration
    ? getMcpIntegrationApiFallback(integration)
    : null;
  const servers = useMemo(
    () => [
      ...(mcpServersQuery.data?.user ?? []),
      ...(mcpServersQuery.data?.org ?? []),
    ],
    [mcpServersQuery.data],
  );
  const connected = integration ? isConnected(integration, servers) : false;
  const hasOrg = Boolean(mcpServersQuery.data?.orgId);
  const canCreateOrgMcp = Boolean(
    hasOrg &&
    (mcpServersQuery.data?.role === "owner" ||
      mcpServersQuery.data?.role === "admin"),
  );
  const shouldSuggest =
    mcpServersQuery.isSuccess &&
    integration &&
    !connected &&
    !dismissedIds.includes(integration.id) &&
    (Boolean(integrationId) ||
      variant === "composer" ||
      isMcpConnectionFailureText(text) ||
      isMcpConnectionSuggestionText(text));

  useEffect(() => {
    if (integration && connected) onConnected?.();
  }, [connected, integration, onConnected]);

  useEffect(() => {
    setError(null);
    setConnecting(false);
  }, [integration?.id, integration?.logoUrl, variant]);

  if (!shouldSuggest) return null;

  const connect = async () => {
    if (!integration || connecting) return;
    setError(null);
    setConnecting(true);

    if (apiFallback) {
      openAgentSettings(`secrets:${apiFallback.secretKey}`);
      setConnecting(false);
      return;
    }

    saveMcpConnectionResume(variant === "response" ? contextText : text);
    setQuickConnectIntegrationId(integration.id);
    setDialogOpen(true);
  };

  const actionLabel = hasApiFallback(apiFallback)
    ? t("mcpIntegrations.useApiToken")
    : t("mcpIntegrations.connect");

  return (
    <>
      <div
        className={
          variant === "response"
            ? "agent-mcp-connection-suggestion agent-mcp-connection-suggestion--response mt-3 flex w-full max-w-[520px] items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[12px]"
            : "agent-mcp-connection-suggestion agent-mcp-connection-suggestion--composer agent-kit-composer-adjacent-width agent-kit-supporting-copy mx-auto mb-2 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2"
        }
        data-mcp-connection-suggestion={integration.id}
        data-mcp-connection-suggestion-variant={variant}
      >
        <McpIntegrationLogo
          name={integration.name}
          logoUrl={integration.logoUrl}
          integrationId={integration.id}
          className="size-6 rounded-md text-[10px]"
          imageClassName="size-5"
        />
        <span className="min-w-0 flex-1 leading-snug text-foreground">
          {t(
            hasApiFallback(apiFallback)
              ? "mcpIntegrations.connectSuggestionWithApiToken"
              : "mcpIntegrations.connectSuggestion",
            { name: integration.name },
          )}
        </span>
        <button
          type="button"
          onClick={() => void connect()}
          disabled={connecting}
          aria-busy={connecting}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-60"
        >
          {connecting && <IconLoader2 className="h-3 w-3 animate-spin" />}
          {!connecting && <IconPlugConnected className="h-3 w-3" />}
          {actionLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            if (connecting) return;
            setError(null);
            setConnecting(true);
            setDismissedIds((current) =>
              current.includes(integration.id)
                ? current
                : [...current, integration.id],
            );
            rememberMcpSuggestionDismissal(integration.id);
            void Promise.resolve(onDismiss?.())
              .catch((cause: unknown) => {
                setError(
                  cause instanceof Error ? cause.message : String(cause),
                );
              })
              .finally(() => setConnecting(false));
          }}
          disabled={connecting}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
          aria-label={t("mcpIntegrations.dismissSuggestion")}
        >
          <IconX className="h-3.5 w-3.5" />
        </button>
      </div>
      {error && (
        <div
          className={
            variant === "response"
              ? "agent-mcp-connection-suggestion-error agent-mcp-connection-suggestion-error--response mt-1 w-full max-w-[520px] text-[11px] text-destructive"
              : "agent-mcp-connection-suggestion-error agent-mcp-connection-suggestion-error--composer agent-kit-composer-adjacent-width agent-kit-caption-copy mx-auto mb-2 text-destructive"
          }
        >
          {error}
        </div>
      )}
      <McpIntegrationDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            if (!oauthStartingRef.current) clearMcpConnectionResume();
            setQuickConnectIntegrationId(null);
            setConnecting(false);
          }
        }}
        initialIntegrationId={integration.id}
        quickConnectIntegrationId={quickConnectIntegrationId}
        presentation="modal"
        defaultScope="user"
        canCreateOrgMcp={canCreateOrgMcp}
        hasOrg={hasOrg}
        onCreateMcpServer={(args) => createMcpServer.mutateAsync(args)}
        onOAuthStart={
          onOAuthStart
            ? async (url) => {
                oauthStartingRef.current = true;
                await onOAuthStart(url);
              }
            : undefined
        }
        onCreated={() => {
          setDismissedIds((current) =>
            current.includes(integration.id)
              ? current
              : [...current, integration.id],
          );
          saveMcpConnectionResume(variant === "response" ? contextText : text);
          notifyMcpConnectionComplete();
          onConnected?.();
        }}
        integrations={integrations}
      />
    </>
  );
}
