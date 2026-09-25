import { Button } from "@agent-native/toolkit/ui/button";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { IconPlus, IconSearch, IconTerminal2 } from "@tabler/icons-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { buildSettingsRoute } from "../../navigation/index.js";
import {
  matchesMcpConnectHost,
  resolveMcpConnectGuideId,
} from "../../shared/mcp-connect-content.js";
import { appPath } from "../api-path.js";
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
  McpServerRows,
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
                className="h-8 gap-1.5 px-3 text-xs"
                onClick={() => setCustomOpen(true)}
              >
                <IconPlus className="size-3.5" aria-hidden="true" />
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

  const serverRows =
    matchingServers.length > 0 ? (
      <McpServerRows
        servers={matchingServers}
        role={mcp.serversQuery.data?.role}
        deleteTarget={mcp.deleteTarget}
        deletePending={mcp.deleteServer.isPending}
        reconnectingKey={mcp.reconnectingKey}
        reconnectError={mcp.reconnectError}
        onRemove={(server) => void mcp.removeServer(server)}
        onReconnect={(server) =>
          server.authMode === "oauth"
            ? startMcpOAuthReconnect(server)
            : void mcp.reconnect(server)
        }
      />
    ) : null;

  const builderLoading = builder.loading && !builder.status;
  const builderUnreadable = !builder.status && !builder.loading;
  const showBuilderInConnected =
    builderConnected && builderMatches && !normalizedQuery;
  const hasConnected = showBuilderInConnected || serverRows !== null;

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
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t(`${K}.noResults`)}
      </p>
    ) : null
  ) : null;

  return (
    <div className="flex flex-col gap-8" data-integrations-page="">
      <label className="relative block w-full">
        <IconSearch
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("mcpIntegrations.searchPlaceholder")}
          aria-label={t("mcpIntegrations.searchPlaceholder")}
          className="h-9 w-full rounded-lg border border-border bg-background pe-3 ps-9 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/30 focus:ring-2 focus:ring-accent/40"
        />
      </label>

      {mcp.deleteError ? (
        <p role="alert" className="text-xs text-destructive">
          {mcp.deleteError}
        </p>
      ) : null}

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
            <p className="mt-1 flex items-center gap-2 text-xs text-destructive">
              {t(`${K}.builderStatusFailed`)}
              <button
                type="button"
                onClick={() => void builder.refetch()}
                className="font-medium underline underline-offset-2 hover:text-foreground"
              >
                {t(`${K}.retry`)}
              </button>
            </p>
          ) : null}
        </TileGroup>
      ) : null}

      {mcp.serversQuery.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {t(`${K}.serversLoadFailed`)}
        </p>
      ) : hasConnected ? (
        <TileGroup title={t("integrations.connectedSection")}>
          <div className="flex flex-col gap-1">
            {showBuilderInConnected ? <TileGrid>{builderTile}</TileGrid> : null}
            {serverRows}
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
                      className="mt-0.5 flex items-center gap-2 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <span className="flex items-center" aria-hidden="true">
                        {rest
                          .slice(0, 2)
                          .map((integration, index) =>
                            catalogLogo(
                              integration,
                              cn(
                                "size-[22px] rounded-md ring-2 ring-background [&_img]:size-[14px]",
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
