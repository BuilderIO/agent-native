import {
  IconArrowUpRight,
  IconLoader2,
  IconPlugConnected,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import { agentNativePath } from "../api-path.js";
import { openAgentSettings } from "../CommandMenu.js";
import { useT } from "../i18n.js";
import {
  buildMcpOAuthStartUrl,
  findMcpIntegrationForText,
  getMcpIntegrationApiFallback,
  getDefaultMcpIntegrations,
  isMcpConnectionFailureText,
  type DefaultMcpIntegration,
} from "./mcp-integration-catalog.js";
import { McpIntegrationDialog } from "./McpIntegrationDialog.js";
import {
  useCreateMcpServer,
  useMcpServers,
  type McpServer,
} from "./use-mcp-servers.js";

export type McpConnectionSuggestionVariant = "composer" | "response";

interface McpConnectionSuggestionProps {
  text: string;
  contextText?: string;
  variant?: McpConnectionSuggestionVariant;
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

function isConnected(
  integration: DefaultMcpIntegration,
  servers: McpServer[],
): boolean {
  const targetUrl = compareUrl(integration.url);
  return servers.some(
    (server) =>
      server.status.state === "connected" &&
      compareUrl(server.url) === targetUrl,
  );
}

function returnUrl(): string {
  if (typeof window === "undefined") return "/";
  return (
    window.location.pathname + window.location.search + window.location.hash
  );
}

function canStartOAuth(integration: DefaultMcpIntegration): boolean {
  return (
    integration.authMode === "oauth" &&
    integration.connectionMode === "oauth" &&
    integration.availability === "ready"
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
}: McpConnectionSuggestionProps) {
  const t = useT();
  const mcpServersQuery = useMcpServers();
  const createMcpServer = useCreateMcpServer();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const integrations = useMemo(() => getDefaultMcpIntegrations(), []);
  const textIntegration = useMemo(
    () => findMcpIntegrationForText(text, integrations),
    [integrations, text],
  );
  const contextIntegration = useMemo(
    () =>
      contextText ? findMcpIntegrationForText(contextText, integrations) : null,
    [contextText, integrations],
  );
  const integration =
    variant === "response" &&
    textIntegration &&
    contextIntegration &&
    textIntegration.id !== contextIntegration.id
      ? null
      : (textIntegration ?? contextIntegration);
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
  const shouldSuggest =
    mcpServersQuery.isSuccess &&
    integration &&
    !connected &&
    dismissedId !== integration.id &&
    (variant === "composer" || isMcpConnectionFailureText(text));

  useEffect(() => {
    setError(null);
    setConnecting(false);
  }, [integration?.id, variant]);

  if (!shouldSuggest) return null;

  const connect = async () => {
    if (!integration || connecting) return;
    setError(null);

    if (apiFallback) {
      openAgentSettings(`secrets:${apiFallback.secretKey}`);
      return;
    }

    if (canStartOAuth(integration)) {
      window.location.assign(
        agentNativePath(
          buildMcpOAuthStartUrl({
            name: integration.name,
            url: integration.url,
            description: integration.description,
            scope: "user",
            returnUrl: returnUrl(),
          }),
        ),
      );
      return;
    }

    if (
      integration.authMode === "none" &&
      integration.connectionMode === "direct"
    ) {
      setConnecting(true);
      try {
        await createMcpServer.mutateAsync({
          scope: "user",
          name: integration.name,
          url: integration.url,
          description: integration.description,
        });
        setDismissedId(integration.id);
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : t("mcpIntegrations.failed"),
        );
      } finally {
        setConnecting(false);
      }
      return;
    }

    setDialogOpen(true);
  };

  const actionLabel = hasApiFallback(apiFallback)
    ? t("mcpIntegrations.useApiToken")
    : canStartOAuth(integration)
      ? t("mcpIntegrations.connectWithOAuth")
      : integration.availability === "client-restricted" ||
          integration.availability === "provider-setup"
        ? t("mcpIntegrations.viewSetup")
        : t("mcpIntegrations.connect");

  return (
    <>
      <div
        className={
          variant === "response"
            ? "mt-3 flex max-w-[520px] items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[12px]"
            : "mx-auto mb-2 flex w-[min(100%,680px)] items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[12px]"
        }
        data-mcp-connection-suggestion={integration.id}
      >
        <div className="relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background text-[10px] font-semibold text-muted-foreground">
          <span aria-hidden="true">{integration.name.slice(0, 1)}</span>
          {integration.logoUrl && (
            <img
              src={integration.logoUrl}
              alt=""
              className="absolute h-5 w-5 object-contain"
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
            />
          )}
        </div>
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
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-60"
        >
          {connecting && <IconLoader2 className="h-3 w-3 animate-spin" />}
          {!connecting &&
            canStartOAuth(integration) &&
            !hasApiFallback(apiFallback) && (
              <IconPlugConnected className="h-3 w-3" />
            )}
          {!connecting && hasApiFallback(apiFallback) && (
            <IconPlugConnected className="h-3 w-3" />
          )}
          {actionLabel}
          {!connecting &&
            !canStartOAuth(integration) &&
            !hasApiFallback(apiFallback) && (
              <IconArrowUpRight className="h-3 w-3" />
            )}
        </button>
        <button
          type="button"
          onClick={() => setDismissedId(integration.id)}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
          aria-label={t("mcpIntegrations.dismissSuggestion")}
        >
          <IconX className="h-3.5 w-3.5" />
        </button>
      </div>
      {error && (
        <div className="mx-auto mb-2 w-[min(100%,680px)] text-[11px] text-destructive">
          {error}
        </div>
      )}
      <McpIntegrationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialIntegrationId={integration.id}
        defaultScope="user"
        canCreateOrgMcp={false}
        hasOrg={Boolean(mcpServersQuery.data?.orgId)}
        onCreateMcpServer={(args) => createMcpServer.mutateAsync(args)}
        onCreated={() => setDismissedId(integration.id)}
      />
    </>
  );
}
