import { Alert, AlertDescription } from "@agent-native/toolkit/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@agent-native/toolkit/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@agent-native/toolkit/ui/input-group";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import {
  IconAlertCircle,
  IconDots,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTerminal2,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { buildSettingsRoute } from "../../navigation/index.js";
import {
  matchesMcpConnectHost,
  resolveMcpConnectGuideId,
} from "../../shared/mcp-connect-content.js";
import { appPath } from "../api-path.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js";
import { useT } from "../i18n.js";
import {
  getDefaultMcpIntegrations,
  isCustomMcpIntegrationEnabled,
  isMcpIntegrationUrl,
  type DefaultMcpIntegration,
} from "../resources/mcp-integration-catalog.js";
import { mcpIntegrationLogo } from "../resources/mcp-integration-logos.js";
import { McpIntegrationDialog } from "../resources/McpIntegrationDialog.js";
import { McpIntegrationLogo } from "../resources/McpIntegrationLogo.js";
import type { McpServer } from "../resources/use-mcp-servers.js";
import {
  useSettingsPageHeader,
  useSettingsShell,
} from "../settings/shell/context.js";
import { useBuilderStatus } from "../settings/useBuilderStatus.js";
import { cn } from "../utils.js";
import {
  groupIntegrationsByCategory,
  INTEGRATION_CATEGORY_PREVIEW_COUNT,
  matchesIntegrationQuery,
  type IntegrationCategory,
} from "./integration-categories.js";
import {
  startMcpOAuthReconnect,
  useMcpIntegrationsController,
} from "./IntegrationsPanel.js";
import {
  SENTENCE_LINK_TOKEN,
  SentenceWithLink,
  SettingsPageLink,
} from "./settings-page-link.js";

const K = "agentChat.settingsShell.integrations";

/** The Builder.io tile and its page share this id with the logo table. */
const BUILDER_LOGO_ID = "builder-cms";

export const BUILDER_INTEGRATION_SUBPAGE = "builder";

const CATEGORY_LABEL_KEYS: Record<IntegrationCategory, string> = {
  engineering: `${K}.category.engineering`,
  design: `${K}.category.design`,
  productivity: `${K}.category.productivity`,
  sales: `${K}.category.sales`,
  support: `${K}.category.support`,
  analytics: `${K}.category.analytics`,
  finance: `${K}.category.finance`,
  other: `${K}.category.other`,
};

// Builder Publish is the content grant, not the Builder.io account; the
// account has its own page, so the catalog entry stays off this page.
function catalogWithoutBuilderPublish(): DefaultMcpIntegration[] {
  return getDefaultMcpIntegrations().filter(
    (integration) => integration.id !== BUILDER_LOGO_ID,
  );
}

function initialQuery(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("q") ?? "";
}

function IntegrationTile({
  name,
  description,
  logo,
  connectable,
  connectLabel,
  onOpen,
}: {
  name: string;
  description?: string;
  logo: ReactNode;
  connectable: boolean;
  connectLabel: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={connectable ? connectLabel : undefined}
      data-integration-tile={name}
      className="flex min-w-0 items-center gap-3 rounded-lg p-2.5 text-start transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {logo}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {name}
        </span>
        {description ? (
          <span className="block truncate text-xs leading-5 text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {connectable ? (
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground"
        >
          <IconPlus className="size-4" />
        </span>
      ) : null}
    </button>
  );
}

function TileGrid({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-2.5 grid grid-cols-1 gap-x-5 md:grid-cols-2">
      {children}
    </div>
  );
}

function TileGroup({
  title,
  children,
  id,
}: {
  title?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-16">
      {title ? (
        <h2 className="mb-1.5 text-sm font-semibold text-foreground">
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

function TileSkeleton() {
  return (
    <div className="flex items-center gap-3 p-2.5">
      <Skeleton className="size-9 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  );
}

function LoadFailedRow({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-4 py-2.5 text-sm text-destructive"
    >
      {message}
      <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

/**
 * A connected MCP server, laid out like the catalog tiles so Connected reads
 * as one grid. Its actions sit in a More actions menu; Remove confirms first.
 */
function ConnectedServerTile({
  server,
  logo,
  canRemove,
  reconnecting,
  reconnectError,
  onReconnect,
  onRemove,
}: {
  server: McpServer;
  logo: ReactNode;
  canRemove: boolean;
  reconnecting: boolean;
  reconnectError: string | null;
  onReconnect: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const failed = server.status.state === "error";
  const scope =
    server.scope === "user"
      ? t("mcpIntegrations.personal")
      : t("mcpIntegrations.sharedWithWorkspace");
  const detail =
    server.status.state === "connected"
      ? `${scope} · ${t("mcpIntegrations.toolsAvailable", {
          count: server.status.toolCount,
        })}`
      : scope;
  return (
    <div
      className="flex min-w-0 items-center gap-3 rounded-lg p-2.5"
      data-connected-server={server.name}
    >
      {logo}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {server.name}
        </span>
        <span className="block truncate text-xs leading-5 text-muted-foreground">
          {detail}
        </span>
        {server.status.state === "error" ? (
          <span
            className="block truncate text-xs leading-5 text-destructive"
            title={server.status.error}
          >
            {reconnectError
              ? t("mcpIntegrations.reconnectFailed", { error: reconnectError })
              : t("mcpIntegrations.connectionErrorReason", {
                  reason: server.status.error,
                })}
          </span>
        ) : null}
      </span>
      {failed || canRemove ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={reconnecting}
              aria-label={t(`${K}.moreActions`, { name: server.name })}
            >
              {reconnecting ? (
                <Spinner aria-hidden="true" />
              ) : (
                <IconDots aria-hidden="true" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {failed ? (
              <DropdownMenuItem onSelect={onReconnect}>
                <IconRefresh className="size-4" aria-hidden="true" />
                {t("mcpIntegrations.reconnect")}
              </DropdownMenuItem>
            ) : null}
            {failed && canRemove ? <DropdownMenuSeparator /> : null}
            {canRemove ? (
              <DropdownMenuItem
                onSelect={onRemove}
                className="text-destructive focus:text-destructive"
              >
                <IconTrash className="size-4" aria-hidden="true" />
                {t(`${K}.remove`)}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

/** "Remove {name}?" naming who loses the integration's tools. */
function RemoveServerDialog({
  server,
  onOpenChange,
  onRemove,
}: {
  server: McpServer | null;
  onOpenChange: (open: boolean) => void;
  onRemove: (server: McpServer) => Promise<unknown>;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep the last server while the dialog animates closed.
  const [shown, setShown] = useState<McpServer | null>(server);
  useEffect(() => {
    if (server) {
      setShown(server);
      setError(null);
    }
  }, [server]);

  const confirm = async () => {
    if (!shown || pending) return;
    setPending(true);
    setError(null);
    try {
      await onRemove(shown);
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : t(`${K}.removeFailed`, { name: shown.name }),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog
      open={server !== null}
      onOpenChange={(open) => {
        if (!pending) onOpenChange(open);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(`${K}.removeTitle`, { name: shown?.name ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {shown?.scope === "org"
              ? t(`${K}.removeWorkspace`, { name: shown.name })
              : t(`${K}.removePersonal`, { name: shown?.name ?? "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <Alert variant="destructive">
            <IconAlertCircle aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel asChild disabled={pending}>
            <Button type="button" variant="secondary">
              {t("common.cancel")}
            </Button>
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? <Spinner aria-hidden="true" /> : null}
            {pending ? t(`${K}.removing`) : t(`${K}.remove`)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function catalogLogo(integration: DefaultMcpIntegration, className?: string) {
  return (
    <McpIntegrationLogo
      key={integration.id}
      name={integration.name}
      logoUrl={integration.logoUrl}
      integrationId={integration.id}
      className={className}
    />
  );
}

export interface IntegrationsPageProps {
  /** A catalog id opens that integration's connect dialog. */
  sub: string | null;
  /** The app's display name, for the MCP server footnote. */
  appName: string;
}

/**
 * Settings › Integrations with the redesign on: the tools the agent uses,
 * Builder.io first, then the catalog by category (spec §5.4). Messaging
 * channels and transactional email live elsewhere.
 */
export function IntegrationsPage({ sub, appName }: IntegrationsPageProps) {
  const t = useT();
  const { navigate } = useSettingsShell();
  const [query, setQuery] = useState(initialQuery);
  const [expanded, setExpanded] = useState<ReadonlySet<IntegrationCategory>>(
    () => new Set(),
  );
  const [customOpen, setCustomOpen] = useState(false);
  const [removing, setRemoving] = useState<McpServer | null>(null);
  const builder = useBuilderStatus();
  const catalog = useMemo(catalogWithoutBuilderPublish, []);
  const mcp = useMcpIntegrationsController({ integrations: catalog });
  const customEnabled = useMemo(() => isCustomMcpIntegrationEnabled(), []);

  const header = useMemo(
    () =>
      customEnabled
        ? {
            action: (
              <Button
                type="button"
                size="sm"
                onClick={() => setCustomOpen(true)}
              >
                <IconPlus aria-hidden="true" />
                {t(`${K}.addCustom`)}
              </Button>
            ),
          }
        : null,
    [customEnabled, t],
  );
  useSettingsPageHeader(header);

  // `/settings/integrations/<id>` (a search hit) opens that integration.
  const { openCatalog } = mcp;
  useEffect(() => {
    if (!sub || sub === BUILDER_INTEGRATION_SUBPAGE) return;
    if (catalog.some((integration) => integration.id === sub)) {
      openCatalog(sub);
    }
  }, [catalog, openCatalog, sub]);

  const normalizedQuery = query.trim().toLowerCase();
  const builderConnected = builder.status?.configured === true;
  const builderDescription = t(`${K}.builderDescription`);
  const openBuilder = () =>
    navigate("integrations", BUILDER_INTEGRATION_SUBPAGE);
  const builderTile = (
    <IntegrationTile
      key="builder"
      name="Builder.io"
      description={builderDescription}
      logo={
        <McpIntegrationLogo
          name="Builder.io"
          logoUrl={mcpIntegrationLogo(BUILDER_LOGO_ID)}
          integrationId={BUILDER_LOGO_ID}
        />
      }
      connectable={!builderConnected}
      connectLabel={t(`${K}.connectName`, { name: "Builder.io" })}
      onOpen={openBuilder}
    />
  );

  const isConnected = (integration: DefaultMcpIntegration) =>
    mcp.connectedServers.some((server) =>
      isMcpIntegrationUrl(integration, server.url),
    );
  const catalogTile = (integration: DefaultMcpIntegration) => (
    <IntegrationTile
      key={integration.id}
      name={integration.name}
      description={integration.description || integration.useCase}
      logo={catalogLogo(integration)}
      connectable
      connectLabel={t(`${K}.connectName`, { name: integration.name })}
      onOpen={() => mcp.openConnection(integration.id, false)}
    />
  );
  const available = catalog.filter(
    (integration) =>
      matchesIntegrationQuery(integration, normalizedQuery) &&
      !isConnected(integration),
  );
  const matchingServers = normalizedQuery
    ? mcp.servers.filter((server) =>
        server.name.toLowerCase().includes(normalizedQuery),
      )
    : mcp.servers;
  const builderMatches =
    !normalizedQuery ||
    `builder.io builder ${builderDescription}`
      .toLowerCase()
      .includes(normalizedQuery);
  const externalHostMatches =
    normalizedQuery.length > 0 && matchesMcpConnectHost(normalizedQuery);

  const serverKey = (server: McpServer) => `${server.scope}:${server.id}`;
  const serverTiles = matchingServers.map((server) => {
    const integration = catalog.find((item) =>
      isMcpIntegrationUrl(item, server.url),
    );
    const key = serverKey(server);
    return (
      <ConnectedServerTile
        key={key}
        server={server}
        logo={
          integration ? (
            catalogLogo(integration)
          ) : (
            <McpIntegrationLogo
              name={server.name}
              logoUrl=""
              integrationId={server.name.toLowerCase()}
            />
          )
        }
        canRemove={
          server.scope === "user" ||
          mcp.serversQuery.data?.role === "owner" ||
          mcp.serversQuery.data?.role === "admin"
        }
        reconnecting={mcp.reconnectingKey === key}
        reconnectError={
          mcp.reconnectError?.key === key ? mcp.reconnectError.message : null
        }
        onReconnect={() =>
          server.authMode === "oauth"
            ? startMcpOAuthReconnect(server)
            : void mcp.reconnect(server)
        }
        onRemove={() => setRemoving(server)}
      />
    );
  });

  const builderLoading = builder.loading && !builder.status;
  const builderUnreadable = !builder.status && !builder.loading;
  const showBuilderInConnected =
    builderConnected && builderMatches && !normalizedQuery;
  const hasConnected = showBuilderInConnected || serverTiles.length > 0;
  const showConnectedEmpty =
    !normalizedQuery &&
    !hasConnected &&
    !!builder.status &&
    mcp.serversQuery.isSuccess === true;

  const openMcpGuide = () => {
    const guide = resolveMcpConnectGuideId(normalizedQuery);
    window.history.pushState(
      null,
      "",
      appPath(
        `${buildSettingsRoute("mcp")}?guide=${encodeURIComponent(guide)}`,
      ),
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const searchResults = normalizedQuery ? (
    available.length > 0 || builderMatches ? (
      <TileGrid>
        {builderMatches ? builderTile : null}
        {available.map(catalogTile)}
      </TileGrid>
    ) : !externalHostMatches && !hasConnected ? (
      <Empty data-integrations-no-results="">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconSearch aria-hidden="true" />
          </EmptyMedia>
          <EmptyDescription>{t(`${K}.noResults`)}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    ) : null
  ) : null;

  return (
    <div className="flex flex-col gap-8" data-integrations-page="">
      <InputGroup size="sm">
        <InputGroupInput
          type="search"
          size="sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("mcpIntegrations.searchPlaceholder")}
          aria-label={t("mcpIntegrations.searchPlaceholder")}
        />
        <InputGroupAddon>
          <IconSearch aria-hidden="true" />
        </InputGroupAddon>
      </InputGroup>

      {!normalizedQuery && builderLoading ? (
        <TileGroup>
          <Skeleton className="mb-2.5 h-3.5 w-24" />
          <TileGrid>
            <TileSkeleton />
          </TileGrid>
        </TileGroup>
      ) : !normalizedQuery && !builderConnected ? (
        <TileGroup
          title={builderUnreadable ? undefined : t("integrations.recommended")}
        >
          <TileGrid>{builderTile}</TileGrid>
          {builderUnreadable ? (
            <LoadFailedRow
              message={t(`${K}.builderStatusFailed`)}
              retryLabel={t(`${K}.retry`)}
              onRetry={() => void builder.refetch()}
            />
          ) : null}
        </TileGroup>
      ) : null}

      {mcp.serversQuery.isError ? (
        <TileGroup title={t("integrations.connectedSection")}>
          {showBuilderInConnected ? <TileGrid>{builderTile}</TileGrid> : null}
          <LoadFailedRow
            message={t(`${K}.serversLoadFailed`)}
            retryLabel={t(`${K}.retry`)}
            onRetry={() => void mcp.serversQuery.refetch()}
          />
        </TileGroup>
      ) : hasConnected ? (
        <TileGroup title={t("integrations.connectedSection")}>
          <TileGrid>
            {showBuilderInConnected ? builderTile : null}
            {serverTiles}
          </TileGrid>
        </TileGroup>
      ) : showConnectedEmpty ? (
        <TileGroup title={t("integrations.connectedSection")}>
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
            <Empty data-integrations-connected-empty="">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconPlugConnected aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>{t(`${K}.connectedEmptyTitle`)}</EmptyTitle>
                <EmptyDescription>
                  {t(`${K}.connectedEmptyDescription`)}
                </EmptyDescription>
              </EmptyHeader>
              {customEnabled ? (
                <EmptyContent>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setCustomOpen(true)}
                  >
                    <IconPlus aria-hidden="true" />
                    {t(`${K}.addCustom`)}
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          </div>
        </TileGroup>
      ) : null}

      {externalHostMatches ? (
        <TileGrid>
          <IntegrationTile
            name={t("settings.mcpClientSetup")}
            description={t("settings.mcpClientSetupDescription")}
            logo={
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground">
                <IconTerminal2 className="size-[18px]" aria-hidden="true" />
              </span>
            }
            connectable
            connectLabel={t(`${K}.connectName`, {
              name: t("settings.mcpClientSetup"),
            })}
            onOpen={openMcpGuide}
          />
        </TileGrid>
      ) : null}

      {normalizedQuery
        ? searchResults
        : groupIntegrationsByCategory(available).map(
            ({ category, integrations }) => {
              const open = expanded.has(category);
              const shown = open
                ? integrations
                : integrations.slice(0, INTEGRATION_CATEGORY_PREVIEW_COUNT);
              const rest = open
                ? []
                : integrations.slice(INTEGRATION_CATEGORY_PREVIEW_COUNT);
              return (
                <TileGroup
                  key={category}
                  id={`integrations-${category}`}
                  title={t(CATEGORY_LABEL_KEYS[category])}
                >
                  <TileGrid>{shown.map(catalogTile)}</TileGrid>
                  {rest.length > 0 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((current) => new Set(current).add(category))
                      }
                      className="mt-0.5 flex items-center gap-2 rounded-md py-2 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex items-center" aria-hidden="true">
                        {rest
                          .slice(0, 2)
                          .map((integration, index) =>
                            catalogLogo(
                              integration,
                              cn(
                                "size-[22px] rounded-md ring-2 ring-background [&_img]:size-[13px]",
                                index > 0 && "-ms-2.5",
                              ),
                            ),
                          )}
                      </span>
                      {rest.length === 1
                        ? t(`${K}.seeMoreOne`, { first: rest[0]!.name })
                        : rest.length === 2
                          ? t(`${K}.seeMoreTwo`, {
                              first: rest[0]!.name,
                              second: rest[1]!.name,
                            })
                          : t(`${K}.seeMoreMany`, {
                              first: rest[0]!.name,
                              second: rest[1]!.name,
                            })}
                    </button>
                  ) : null}
                </TileGroup>
              );
            },
          )}

      <p className="text-xs leading-5 text-muted-foreground">
        <SentenceWithLink
          text={t(`${K}.footnote`, {
            app: appName,
            link: SENTENCE_LINK_TOKEN,
          })}
          link={
            <SettingsPageLink page="mcp">
              {t("agentChat.settingsShell.page.mcp")}
            </SettingsPageLink>
          }
        />
      </p>

      <McpIntegrationDialog
        open={mcp.dialogOpen}
        onOpenChange={(open) => {
          mcp.setDialogOpen(open);
          if (!open) {
            mcp.setInitialIntegrationId(null);
            mcp.setConnectIntegrationId(null);
            if (sub && sub !== BUILDER_INTEGRATION_SUBPAGE) {
              navigate("integrations", null, { replace: true });
            }
          }
        }}
        initialIntegrationId={mcp.initialIntegrationId}
        connectIntegrationId={mcp.connectIntegrationId}
        defaultScope="user"
        canCreateOrgMcp={mcp.canCreateOrgMcp}
        hasOrg={mcp.hasOrg}
        integrations={catalog}
        onCreateMcpServer={(args) => mcp.createServer.mutateAsync(args)}
      />
      <RemoveServerDialog
        server={removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        onRemove={(server) =>
          mcp.deleteServer.mutateAsync({ id: server.id, scope: server.scope })
        }
      />
      {customEnabled ? (
        // No catalog entries: the dialog opens straight on its custom-server
        // form, which is the "Add custom integration" flow.
        <McpIntegrationDialog
          open={customOpen}
          onOpenChange={setCustomOpen}
          presentation="modal"
          integrations={NO_CATALOG}
          defaultScope="user"
          canCreateOrgMcp={mcp.canCreateOrgMcp}
          hasOrg={mcp.hasOrg}
          onCreateMcpServer={(args) => mcp.createServer.mutateAsync(args)}
        />
      ) : null}
    </div>
  );
}

const NO_CATALOG: DefaultMcpIntegration[] = [];
