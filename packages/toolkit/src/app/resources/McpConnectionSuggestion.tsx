import { useT } from "@agent-native/core/client/i18n";
import {
  clearMcpConnectionResume,
  notifyMcpConnectionComplete,
  saveMcpConnectionResume,
} from "@agent-native/core/client/resources/mcp-connection-resume";
import {
  getMcpIntegrationApiFallback,
  getDefaultMcpIntegrations,
  isMcpIntegrationUrl,
  type DefaultMcpIntegration,
} from "@agent-native/core/client/resources/mcp-integration-catalog";
import {
  isMcpServersPending,
  useCreateMcpServer,
  useMcpServers,
  type McpServer,
} from "@agent-native/core/client/resources/use-mcp-servers";
import { IconLoader2, IconPlugConnected, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { openAgentSettings } from "../shared/index.js";
import { McpIntegrationDialogDeferred } from "./McpIntegrationDialogDeferred.js";
import { McpIntegrationLogo } from "./McpIntegrationLogo.js";

export type McpConnectionSuggestionVariant = "composer" | "response";

export interface McpConnectionSuggestionProps {
  text: string;
  contextText?: string;
  variant?: McpConnectionSuggestionVariant;
  requestedByAgent?: boolean;
  integrations?: DefaultMcpIntegration[];
  excludedIntegrationIds?: readonly string[];
  integrationId?: string;
  onConnected?: () => void | Promise<void>;
  onDismiss?: () => void | Promise<void>;
  onOAuthStart?: (url: string) => void | Promise<void>;
}

const DISMISSED_MCP_SUGGESTIONS_STORAGE_KEY =
  "agent-native:mcp-connection-suggestions-dismissed";
const MCP_SUGGESTION_DISMISSAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function readDismissedMcpSuggestionTimestamps(
  now = Date.now(),
): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(
      DISMISSED_MCP_SUGGESTIONS_STORAGE_KEY,
    );
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const timestamps = Object.fromEntries(
        parsed
          .filter((id): id is string => typeof id === "string")
          .map((id) => [id, now]),
      ) as Record<string, number>;
      try {
        // Legacy IDs have no timestamp, so start their cooldown at migration.
        window.localStorage.setItem(
          DISMISSED_MCP_SUGGESTIONS_STORAGE_KEY,
          JSON.stringify(timestamps),
        );
      } catch {
        // coercion-ok: unavailable storage cannot persist the migration.
      }
      return timestamps;
    }
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const timestamps: Record<string, number> = {};
    for (const [id, dismissedAt] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (
        typeof dismissedAt === "number" &&
        Number.isFinite(dismissedAt) &&
        dismissedAt <= now &&
        now - dismissedAt < MCP_SUGGESTION_DISMISSAL_WINDOW_MS
      ) {
        timestamps[id] = dismissedAt;
      }
    }
    return timestamps;
  } catch {
    // coercion-ok: unavailable browser storage means no persisted dismissals.
    return {};
  }
}

function rememberMcpSuggestionDismissal(id: string, dismissedAt: number): void {
  if (typeof window === "undefined") return;
  try {
    const timestamps = readDismissedMcpSuggestionTimestamps(dismissedAt);
    window.localStorage.setItem(
      DISMISSED_MCP_SUGGESTIONS_STORAGE_KEY,
      JSON.stringify({ ...timestamps, [id]: dismissedAt }),
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

// A request reads "please connect Slack", "you'll need to reconnect Linear",
// or "Notion isn't connected". Product copy ("Users can connect Slack"), quoted
// button labels ("Connect Notion"), negations ("no need to connect GitHub"),
// and links never count: pasted prompts and drafted copy are full of them.
const CONNECT_REQUEST_LEAD = String.raw`(?:^|[.!?]\s+|\bplease\s+|\b(?:you|you['’]ll|you\s+will)\s+(?:need|have)\s+to\s+|\byou\s+(?:must|should)\s+|\bneed\s+you\s+to\s+|\b(?:can|could|would|will)\s+you(?:\s+please)?\s+|\b(?:if|once|when|after)\s+you\s+|\b(?:to\s+continue|first|then|just),?\s+|,\s+|\b(?:settings|integrations)\s+and\s+|\b(?:i|we)(?:\s+(?:want|need|would\s+like)|['’]d\s+like)\s+to\s+|\bhelp\s+(?:me|us)\s+|\bhow\s+(?:do|can)\s+(?:i|we)\s+|\blet['’]?s\s+)`;
const CONNECT_REQUEST_VERB = String.raw`(?:re-?)?(?:connect|authori[sz]e)|(?:sign|log)\s+in(?:to|\s+to)`;
const CONNECTION_MISSING = String.raw`(?:(?:is|has|was)(?:\s+not|n['’]t)(?:\s+(?:been|yet|currently))?\s+connected|(?:access|connection)\s+(?:(?:has\s+)?expired|(?:is\s+)?required))`;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findRequestedMcpIntegration(
  markdown: string,
  integrations: readonly DefaultMcpIntegration[],
): DefaultMcpIntegration | null {
  // Agents bold or code-format the provider: "please connect **Slack**".
  const text = markdown.replace(/\*\*|__|`/g, "");
  if (!/connect|authori[sz]e|sign\s+in|log\s+in|expired|required/i.test(text)) {
    return null;
  }
  const byName = new Map<
    string,
    { integration: DefaultMcpIntegration; name: string }
  >();
  for (const integration of integrations) {
    for (const alias of [
      ...(integration.promptAliases ?? [integration.name]),
      ...(integration.brandAliases ?? []),
    ]) {
      const name = alias.replace(/^connect\s+/i, "");
      byName.set(name.toLowerCase(), { integration, name });
    }
  }
  if (byName.size === 0) return null;
  const names = `(${[...byName.values()]
    .map(({ name }) => name)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|")})(?![\\w-])`;
  const patterns = [
    new RegExp(
      `(?<=${CONNECT_REQUEST_LEAD})(?:${CONNECT_REQUEST_VERB})\\s+(?:to\\s+|with\\s+)?(?:my\\s+|our\\s+|your\\s+|the\\s+)?${names}`,
      "gi",
    ),
  ];
  if (/\b(?:connected|expired|required)\b/i.test(text)) {
    patterns.push(
      new RegExp(`(?<![\\w-])${names}\\s+${CONNECTION_MISSING}`, "gi"),
    );
  }
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const found = match.at(1);
      if (!found) continue;
      const entry = byName.get(found.toLowerCase());
      // Brand names are capitalized: "linear gradient" is not Linear.
      if (entry && found[0] === entry.name[0]) return entry.integration;
    }
  }
  return null;
}

export function findMcpConnectionSuggestionIntegration({
  text,
  variant = "composer",
  requestedByAgent = false,
  integrations = getDefaultMcpIntegrations(),
  excludedIntegrationIds,
  integrationId,
}: McpConnectionSuggestionProps): DefaultMcpIntegration | null {
  const excludedIds = new Set(
    excludedIntegrationIds?.map((id) => id.trim().toLowerCase()) ?? [],
  );
  const availableIntegrations = integrations.filter(
    (integration) =>
      !excludedIds.has(integration.id.toLowerCase()) &&
      !excludedIds.has(integration.provider.toLowerCase()),
  );
  if (integrationId) {
    const normalized = integrationId.trim().toLowerCase();
    return (
      availableIntegrations.find(
        (integration) =>
          integration.id.toLowerCase() === normalized ||
          integration.provider.toLowerCase() === normalized,
      ) ?? null
    );
  }
  if (variant !== "response" && !requestedByAgent) return null;
  return findRequestedMcpIntegration(
    visibleUserAuthoredText(text),
    availableIntegrations,
  );
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
  excludedIntegrationIds,
  integrationId,
  onConnected,
  onDismiss,
  onOAuthStart,
}: McpConnectionSuggestionProps) {
  const t = useT();
  const mcpServersQuery = useMcpServers({ defer: true });
  const createMcpServer = useCreateMcpServer();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [quickConnectIntegrationId, setQuickConnectIntegrationId] = useState<
    string | null
  >(null);
  const [dismissedAtById, setDismissedAtById] = useState(
    readDismissedMcpSuggestionTimestamps,
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
        variant,
        requestedByAgent,
        integrations,
        excludedIntegrationIds,
        integrationId,
      }),
    [
      excludedIntegrationIds,
      integrationId,
      integrations,
      requestedByAgent,
      text,
      variant,
    ],
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
  const serversPending = isMcpServersPending(mcpServersQuery);
  const hasOrg = !serversPending && Boolean(mcpServersQuery.data?.orgId);
  const canCreateOrgMcp = Boolean(
    hasOrg &&
    !serversPending &&
    (mcpServersQuery.data?.role === "owner" ||
      mcpServersQuery.data?.role === "admin"),
  );
  const dismissedAt = integration ? dismissedAtById[integration.id] : undefined;
  const dismissed =
    dismissedAt !== undefined &&
    Date.now() - dismissedAt < MCP_SUGGESTION_DISMISSAL_WINDOW_MS;
  const shouldSuggest =
    mcpServersQuery.isSuccess && integration && !connected && !dismissed;

  useEffect(() => {
    if (integration && connected) onConnected?.();
  }, [connected, integration, onConnected]);

  useEffect(() => {
    setError(null);
    setConnecting(false);
  }, [integration?.id, integration?.logoUrl, variant]);

  useEffect(() => {
    if (!integration || dismissedAt === undefined) return;
    const timeout = window.setTimeout(
      () => setDismissedAtById(readDismissedMcpSuggestionTimestamps()),
      Math.max(
        0,
        dismissedAt + MCP_SUGGESTION_DISMISSAL_WINDOW_MS - Date.now(),
      ),
    );
    return () => window.clearTimeout(timeout);
  }, [dismissedAt, integration?.id]);

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
            const dismissedAt = Date.now();
            setDismissedAtById((current) => ({
              ...current,
              [integration.id]: dismissedAt,
            }));
            rememberMcpSuggestionDismissal(integration.id, dismissedAt);
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
      <McpIntegrationDialogDeferred
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
        defaultScope="org"
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
          setDismissedAtById((current) => ({
            ...current,
            [integration.id]: Date.now(),
          }));
          saveMcpConnectionResume(variant === "response" ? contextText : text);
          notifyMcpConnectionComplete();
          onConnected?.();
        }}
        integrations={integrations}
      />
    </>
  );
}
