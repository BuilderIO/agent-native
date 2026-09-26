import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@agent-native/toolkit/ui/alert";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@agent-native/toolkit/ui/empty";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@agent-native/toolkit/ui/toggle-group";
import {
  IconAlertCircle,
  IconCircleOff,
  IconExternalLink,
  IconInfoCircle,
  IconLock,
  IconPlugConnected,
} from "@tabler/icons-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { toast } from "sonner";

import { agentNativePath } from "../api-path.js";
import { submitToAgent } from "../CommandMenu.js";
import { useT } from "../i18n.js";
import { useOrg } from "../org/hooks.js";
import {
  buildMcpOAuthStartUrl,
  navigateToMcpOAuthStart,
  requiresMcpIntegrationOrganizationScope,
  supportsMcpIntegrationOrganizationScope,
  isMcpIntegrationUrl,
  type DefaultMcpIntegration,
} from "../resources/mcp-integration-catalog.js";
import { McpIntegrationDialog } from "../resources/McpIntegrationDialog.js";
import { McpIntegrationLogo } from "../resources/McpIntegrationLogo.js";
import {
  formatMcpServerError,
  type McpServer,
  type McpServerScope,
} from "../resources/use-mcp-servers.js";
import { saveApiKeyValue } from "../settings/api-keys/api-keys-client.js";
import { SettingsGroup, SettingsRow } from "../settings/SettingsRow.js";
import {
  useSettingsPageHeader,
  useSettingsShell,
} from "../settings/shell/context.js";
import type { SettingsPageContext } from "../settings/shell/registry.js";
import { integrationBrand } from "./brand/integration-brands.js";
import { listChannelsForSettings } from "./channel-setup.js";
import { integrationCategory } from "./integration-categories.js";
import {
  BrandMark,
  BreadcrumbTitle,
  CopyField,
  IntegrationHero,
  LockedValue,
  RowValue,
} from "./IntegrationDetailParts.js";
import {
  CATEGORY_LABEL_KEYS,
  catalogWithoutBuilderPublish,
  RemoveServerDialog,
} from "./IntegrationsPage.js";
import { useMcpIntegrationsController } from "./IntegrationsPanel.js";

const K = "agentChat.settingsShell.integrationDetail";
const CH = "agentChat.settingsShell.channels";

// Integrations and Channels shared one page before the redesign, so old links
// can name a channel under Integrations.
const CHANNEL_ALIASES: Readonly<Record<string, string>> = {
  "google-workspace": "google-docs",
};

type SignIn = "oauth" | "token" | "none";

/** How the viewer connects: a token covers a header connection and an API fallback. */
function signInOf(integration: DefaultMcpIntegration): SignIn {
  if (integration.apiFallback || integration.authMode === "headers") {
    return "token";
  }
  return integration.authMode === "oauth" ? "oauth" : "none";
}

/**
 * Who has to act before anyone connects: an admin registering an OAuth app
 * for the workspace, or the provider's own admin allowing the client.
 */
function gateOf(
  integration: DefaultMcpIntegration,
): "workspace" | "provider" | null {
  if (integration.availability !== "provider-setup") return null;
  return integration.connectionMode === "manual" ? "workspace" : "provider";
}

/** `Authorization: Bearer <token>` with the token in place of the placeholder. */
function tokenHeaders(
  integration: DefaultMcpIntegration,
  token: string,
): Record<string, string> {
  const template =
    integration.headerPlaceholder ?? "Authorization: Bearer <token>";
  const colon = template.indexOf(":");
  const name = template.slice(0, colon).trim();
  const value = template
    .slice(colon + 1)
    .trim()
    .replace(/<[^>]+>/, token);
  return { [name]: value };
}

function ExternalRowLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="link" size="sm">
      <a href={href} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    </Button>
  );
}

function TokenDialog({
  open,
  onOpenChange,
  integration,
  scope,
  onCreateServer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integration: DefaultMcpIntegration;
  scope: McpServerScope;
  onCreateServer: (args: {
    scope: McpServerScope;
    name: string;
    url: string;
    headers: Record<string, string>;
    description?: string;
  }) => Promise<unknown>;
}) {
  const t = useT();
  const fieldId = useId();
  const hintId = useId();
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setToken("");
      setError(null);
    }
  }, [open]);

  const hintKey = integrationBrand(integration.id)?.tokenHint;
  const hint = hintKey ? t(hintKey) : null;
  const docsUrl = integration.apiFallback?.docsUrl ?? integration.docsUrl;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = token.trim();
    if (!value || pending) return;
    setPending(true);
    setError(null);
    try {
      if (integration.apiFallback) {
        await saveApiKeyValue({
          name: integration.apiFallback.secretKey,
          value,
          registered: true,
        });
      } else {
        await onCreateServer({
          scope,
          name: integration.name,
          url: integration.url,
          headers: tokenHeaders(integration, value),
          description: integration.description || undefined,
        });
      }
      onOpenChange(false);
      toast.success(t(`${K}.connected`, { name: integration.name }));
    } catch (cause) {
      setError(formatMcpServerError(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-[480px]" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {t("agentChat.settingsShell.integrations.connectName", {
              name: integration.name,
            })}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor={fieldId}>{t(`${K}.accessToken`)}</Label>
            <Input
              id={fieldId}
              type="password"
              autoComplete="off"
              autoFocus
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={t(`${K}.tokenPlaceholder`, {
                name: integration.name,
              })}
              aria-describedby={hint ? hintId : undefined}
            />
            {hint ? (
              <p
                id={hintId}
                className="text-xs leading-5 text-muted-foreground"
              >
                {hint}
              </p>
            ) : null}
          </div>
          {docsUrl ? (
            <a
              href={docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline"
            >
              {t(`${K}.howToCreateToken`)}
              <IconExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <IconAlertCircle aria-hidden="true" />
              <AlertDescription className="break-words">
                {error}
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              {t("agentChat.common.cancel")}
            </Button>
            <Button type="submit" disabled={!token.trim() || pending}>
              {pending ? <Spinner aria-hidden="true" /> : null}
              {pending
                ? t("mcpIntegrations.connecting")
                : t("mcpIntegrations.connect")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConnectedRow({
  server,
  canRemove,
  onRemove,
}: {
  server: McpServer;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const t = useT();
  const scope =
    server.scope === "user"
      ? t("mcpIntegrations.personal")
      : t("mcpIntegrations.sharedWithWorkspace");
  return (
    <SettingsRow
      label={
        server.status.state === "error"
          ? t("mcpIntegrations.connectionError")
          : t("mcpIntegrations.connected")
      }
      description={
        server.status.state === "connected"
          ? `${scope} · ${t("mcpIntegrations.toolsAvailable", {
              count: server.status.toolCount,
            })}`
          : server.status.state === "error"
            ? t("mcpIntegrations.connectionErrorReason", {
                reason: server.status.error,
              })
            : scope
      }
      control={
        canRemove ? (
          <Button
            type="button"
            variant="secondary-destructive"
            size="sm"
            onClick={onRemove}
          >
            {t("agentChat.settingsShell.integrations.remove")}
          </Button>
        ) : null
      }
    />
  );
}

function NotFound() {
  const t = useT();
  const header = useMemo(() => ({ title: t(`${K}.notFoundTitle`) }), [t]);
  useSettingsPageHeader(header);
  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
      <Empty data-integration-not-found="">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconPlugConnected aria-hidden="true" />
          </EmptyMedia>
          <EmptyDescription>{t(`${K}.notFound`)}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

export interface IntegrationDetailPageProps {
  /** The catalog id from `/settings/integrations/:id`. */
  id: string;
  appName: string;
  context: SettingsPageContext;
}

/**
 * One catalog integration's page (spec §5.4): example prompts, what it does,
 * a callout when something has to happen first, then Connection and
 * Information. Connecting opens in place: OAuth in a popup, a token in a
 * dialog, and provider setup in the connect dialog.
 */
export function IntegrationDetailPage({
  id,
  appName,
  context,
}: IntegrationDetailPageProps) {
  const catalog = useMemo(catalogWithoutBuilderPublish, []);
  const integration = catalog.find((entry) => entry.id === id);
  const { navigate } = useSettingsShell();
  const channelId = CHANNEL_ALIASES[id] ?? id;
  const isChannel =
    !integration &&
    listChannelsForSettings().some((channel) => channel.id === channelId);

  useEffect(() => {
    if (isChannel) navigate("channels", channelId, { replace: true });
  }, [channelId, isChannel, navigate]);

  if (isChannel) return null;
  if (!integration) return <NotFound />;
  return (
    <IntegrationDetail
      key={integration.id}
      integration={integration}
      catalog={catalog}
      appName={appName}
      context={context}
    />
  );
}

function IntegrationDetail({
  integration,
  catalog,
  appName,
  context,
}: {
  integration: DefaultMcpIntegration;
  catalog: DefaultMcpIntegration[];
  appName: string;
  context: SettingsPageContext;
}) {
  const t = useT();
  const org = useOrg();
  const mcp = useMcpIntegrationsController({ integrations: catalog });
  const brand = integrationBrand(integration.id);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [removing, setRemoving] = useState<McpServer | null>(null);
  const [shared, setShared] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const name = integration.name;
  const orgName =
    org.data?.orgName ?? t("agentChat.settingsShell.builder.orgFallback");
  const signIn = signInOf(integration);
  const gate = gateOf(integration);
  const unavailable = brand?.unavailable === true;
  const orgOnly = requiresMcpIntegrationOrganizationScope(integration);
  const canShare =
    supportsMcpIntegrationOrganizationScope(integration) && mcp.canCreateOrgMcp;
  const scope: McpServerScope =
    orgOnly || (canShare && shared) ? "org" : "user";
  const servers = mcp.servers.filter((server) =>
    isMcpIntegrationUrl(integration, server.url),
  );
  const serversKnown = mcp.serversQuery.isSuccess || mcp.serversQuery.isError;

  const connect = async () => {
    // No preset URL (Sigma's is per account): the connect dialog asks for it.
    if (!integration.url.trim()) {
      setSetupOpen(true);
      return;
    }
    if (signIn === "oauth") {
      const returnUrl = `${window.location.pathname}${window.location.search}`;
      const opened = navigateToMcpOAuthStart(
        agentNativePath(
          buildMcpOAuthStartUrl({
            name,
            url: integration.url,
            description: integration.description,
            scope,
            returnUrl,
          }),
        ),
      );
      if (!opened) toast.error(t("mcpIntegrations.connectionError"));
      return;
    }
    setConnecting(true);
    try {
      await mcp.createServer.mutateAsync({
        scope,
        name,
        url: integration.url,
        description: integration.description || undefined,
      });
      toast.success(t(`${K}.connected`, { name }));
    } catch (cause) {
      toast.error(formatMcpServerError(cause));
    } finally {
      setConnecting(false);
    }
  };

  // The header is memoized, so its button reads the latest scope through this.
  const connectRef = useRef(connect);
  connectRef.current = connect;

  const logoUrl = integration.logoUrl;
  const connected = servers.length > 0;
  const isAdmin = context.isAdmin;
  const header = useMemo(() => {
    const action =
      !serversKnown || connected || unavailable ? null : gate ===
        "workspace" ? (
        isAdmin ? (
          <Button type="button" size="sm" onClick={() => setSetupOpen(true)}>
            {t(`${K}.setUp`)}
          </Button>
        ) : null
      ) : signIn === "token" ? (
        <Button type="button" size="sm" onClick={() => setTokenOpen(true)}>
          {t(`${K}.addAccessToken`)}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          disabled={connecting}
          onClick={() => void connectRef.current()}
        >
          {connecting ? <Spinner aria-hidden="true" /> : null}
          {connecting
            ? t("mcpIntegrations.connecting")
            : t("mcpIntegrations.connect")}
        </Button>
      );
    return {
      title: (
        <BreadcrumbTitle
          name={name}
          mark={
            <BrandMark
              logoUrl={logoUrl}
              logoId={integration.id}
              className="size-4 rounded-[3px]"
            />
          }
        />
      ),
      action,
    };
  }, [
    connected,
    connecting,
    gate,
    integration.id,
    isAdmin,
    logoUrl,
    name,
    serversKnown,
    signIn,
    t,
    unavailable,
  ]);
  useSettingsPageHeader(header);

  const prompts = (brand?.prompts ?? []).map((key) =>
    t(key, {
      app: appName,
      host: typeof window === "undefined" ? "" : window.location.host,
    }),
  );
  const description = t(integration.descriptionKey, {
    defaultValue: integration.description,
  });
  const access =
    signIn === "oauth"
      ? t(`${K}.access.oauth`, { name })
      : signIn === "token"
        ? t(`${K}.access.token`)
        : t(`${K}.access.none`);
  const setupNote = integration.setupNoteKey ? t(integration.setupNoteKey) : "";
  const guide = integration.docsUrl ? (
    <>
      {" "}
      <a
        href={integration.docsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-foreground underline underline-offset-4"
      >
        {t("mcpIntegrations.viewSetup")}
      </a>
    </>
  ) : null;
  const callout = unavailable
    ? {
        icon: IconCircleOff,
        title: t(`${K}.callout.unavailable`),
        body: setupNote,
        guide: null,
      }
    : gate === "workspace" && !context.isAdmin
      ? {
          icon: IconLock,
          title: t(`${K}.callout.adminNeeded`),
          body: t(`${K}.callout.adminNeededBody`, { org: orgName, name }),
          guide: null,
        }
      : gate === "workspace"
        ? {
            icon: IconInfoCircle,
            title: t(`${K}.callout.beforeAnyone`),
            body: setupNote,
            guide,
          }
        : setupNote && (gate === "provider" || integration.apiFallback)
          ? {
              icon: IconInfoCircle,
              title:
                gate === "provider"
                  ? t(`${K}.callout.beforeYouConnect`)
                  : t(`${K}.callout.token`),
              body: setupNote,
              guide,
            }
          : null;

  const whoRow = orgOnly ? (
    <SettingsRow
      id="who-can-use-it"
      label={t(`${K}.who`)}
      description={t(`${K}.whoOrgOnly`, { org: orgName })}
      control={<RowValue>{orgName}</RowValue>}
    />
  ) : !supportsMcpIntegrationOrganizationScope(integration) || !mcp.hasOrg ? (
    <SettingsRow
      id="who-can-use-it"
      label={t(`${K}.who`)}
      description={t(`${K}.whoPersonal`)}
      control={<RowValue>{t(`${K}.justMe`)}</RowValue>}
    />
  ) : canShare ? (
    <SettingsRow
      id="who-can-use-it"
      label={t(`${K}.who`)}
      description={t(`${K}.whoShared`, { org: orgName })}
      control={
        <ToggleGroup
          type="single"
          size="sm"
          value={shared ? "org" : "user"}
          onValueChange={(value) => {
            if (value) setShared(value === "org");
          }}
          aria-label={t(`${K}.who`)}
        >
          <ToggleGroupItem value="user" className="px-3">
            {t(`${K}.justMe`)}
          </ToggleGroupItem>
          <ToggleGroupItem value="org" className="px-3">
            {orgName}
          </ToggleGroupItem>
        </ToggleGroup>
      }
    />
  ) : (
    <SettingsRow
      id="who-can-use-it"
      label={t(`${K}.who`)}
      description={t(`${K}.whoMember`, { org: orgName })}
      control={
        <LockedValue
          value={t(`${K}.justMe`)}
          reason={t(`${K}.whoMember`, { org: orgName })}
        />
      }
    />
  );

  const role = mcp.serversQuery.data?.role;
  const category = integrationCategory(integration.id);

  return (
    <div className="flex flex-col gap-8" data-integration-page={integration.id}>
      <div className="flex flex-col gap-5">
        {prompts.length > 0 ? (
          <IntegrationHero
            name={name}
            hue={brand?.hue}
            mark={
              <BrandMark
                logoUrl={logoUrl}
                logoId={integration.id}
                className="size-[15px]"
              />
            }
            heroMark={
              <McpIntegrationLogo
                name={name}
                logoUrl={logoUrl}
                integrationId={integration.id}
                className="size-12 rounded-xl shadow-sm"
              />
            }
            prompts={prompts}
            onAsk={submitToAgent}
          />
        ) : null}
        <p className="max-w-[680px] px-0.5 text-sm leading-[1.6] text-muted-foreground">
          {description} {access}
        </p>
        {callout ? (
          <Alert data-integration-callout="">
            <callout.icon aria-hidden="true" />
            <AlertTitle>{callout.title}</AlertTitle>
            <AlertDescription>
              {callout.body}
              {callout.guide}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <SettingsGroup id="connection" title={t(`${CH}.connection`)}>
        {servers.map((server) => (
          <ConnectedRow
            key={`${server.scope}:${server.id}`}
            server={server}
            canRemove={
              server.scope === "user" || role === "owner" || role === "admin"
            }
            onRemove={() => setRemoving(server)}
          />
        ))}
        {whoRow}
        <SettingsRow
          id="sign-in"
          label={t(`${K}.signIn`)}
          control={
            <RowValue>
              {signIn === "oauth"
                ? t("mcpIntegrations.auth.oauth")
                : signIn === "token"
                  ? t(`${K}.accessToken`)
                  : t(`${K}.signInNone`)}
            </RowValue>
          }
        />
      </SettingsGroup>

      <SettingsGroup id="information" title={t(`${CH}.information`)}>
        <SettingsRow
          id="developer"
          label={t(`${K}.developer`)}
          control={<RowValue>{brand?.developer ?? name}</RowValue>}
        />
        <SettingsRow
          id="category"
          label={t(`${K}.category`)}
          control={<RowValue>{t(CATEGORY_LABEL_KEYS[category])}</RowValue>}
        />
        {integration.availability === "beta" ? (
          <SettingsRow
            id="status"
            label={t(`${CH}.status`)}
            control={
              <Badge variant="outline">
                {t("mcpIntegrations.status.beta")}
              </Badge>
            }
          />
        ) : null}
        {/* An API fallback connects without the server, and an unavailable
            one can't be reached, so neither URL is one to copy. */}
        {integration.url && !unavailable && !integration.apiFallback ? (
          <SettingsRow
            id="server-url"
            label={t(`${K}.serverUrl`)}
            control={
              <CopyField
                value={integration.url}
                label={t(`${K}.copyServerUrl`)}
              />
            }
          />
        ) : null}
        {integration.docsUrl ? (
          <SettingsRow
            id="documentation"
            label={t(`${CH}.documentation`)}
            control={
              <ExternalRowLink
                href={integration.docsUrl}
                label={t(`${CH}.openDocs`)}
              />
            }
          />
        ) : null}
      </SettingsGroup>

      <TokenDialog
        open={tokenOpen}
        onOpenChange={setTokenOpen}
        integration={integration}
        scope={scope}
        onCreateServer={(args) => mcp.createServer.mutateAsync(args)}
      />
      <McpIntegrationDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        presentation="modal"
        initialIntegrationId={setupOpen ? integration.id : null}
        defaultScope={scope}
        canCreateOrgMcp={mcp.canCreateOrgMcp}
        hasOrg={mcp.hasOrg}
        integrations={[integration]}
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
    </div>
  );
}
