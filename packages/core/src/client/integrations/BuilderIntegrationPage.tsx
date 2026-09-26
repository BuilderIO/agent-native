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
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import {
  IconAlertCircle,
  IconBox,
  IconBrowser,
  IconCode,
  IconCpu,
  IconMicrophone,
  IconPalette,
  IconPhoto,
  IconRefresh,
  IconSearch,
  IconUnlink,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ComponentType } from "react";

import type {
  BuilderConnectionState,
  BuilderDisconnectResult,
} from "../../agent/actions/manage-builder-connection.js";
import type { ServiceProvidersStatus } from "../../agent/actions/manage-service-providers.js";
import type { FileStorageStatus } from "../../file-upload/storage-settings.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js";
import { useT } from "../i18n.js";
import { useOrg } from "../org/hooks.js";
import { mcpIntegrationLogo } from "../resources/mcp-integration-logos.js";
import { DeferredBuilderConnectPopover } from "../settings/deferred-builder-connect-popover.js";
import { SettingsGroup, SettingsRow } from "../settings/SettingsRow.js";
import { useSettingsPageHeader } from "../settings/shell/context.js";
import type { SettingsPageContext } from "../settings/shell/registry.js";
import {
  useBuilderConnectFlow,
  type BuilderConnectFlow,
  type BuilderConnectionScope,
} from "../settings/useBuilderStatus.js";
import {
  actionErrorMessage,
  callAction,
  useActionMutation,
  useActionQuery,
} from "../use-action.js";
import {
  builderUsages,
  type BuilderUsage,
  type BuilderUsageId,
  type BuilderUsageLoss,
} from "./builder-usage.js";
import { BrandMark, BreadcrumbTitle } from "./IntegrationDetailParts.js";
import {
  SENTENCE_LINK_TOKEN,
  SentenceWithLink,
  SettingsPageLink,
} from "./settings-page-link.js";

const K = "agentChat.settingsShell.builder";
const TRACKING_SOURCE = "settings_builder_page";

const USAGE_META: Record<
  BuilderUsageId,
  { icon: ComponentType<{ className?: string }>; label: string; note: string }
> = {
  "ai-model": {
    icon: IconCpu,
    label: `${K}.use.aiModel`,
    note: `${K}.use.aiModelNote`,
  },
  "file-storage": {
    icon: IconBox,
    label: "agentChat.settingsShell.search.fileUploads",
    note: `${K}.use.fileStorageNote`,
  },
  voice: {
    icon: IconMicrophone,
    label: `${K}.use.voice`,
    note: `${K}.use.voiceNote`,
  },
  images: {
    icon: IconPhoto,
    label: `${K}.use.images`,
    note: `${K}.use.imagesNote`,
  },
  embeddings: {
    icon: IconSearch,
    label: `${K}.use.embeddings`,
    note: `${K}.use.embeddingsNote`,
  },
  "design-system": {
    icon: IconPalette,
    label: `${K}.use.designSystem`,
    note: `${K}.use.designSystemNote`,
  },
  "background-agents": {
    icon: IconCode,
    label: "agentChat.settingsShell.search.backgroundAgents",
    note: `${K}.use.backgroundAgentsNote`,
  },
  "browser-automation": {
    icon: IconBrowser,
    label: "agentChat.settingsShell.search.browserAutomation",
    note: `${K}.use.browserAutomationNote`,
  },
};

const LOSS_KEYS: Record<BuilderUsageLoss, string> = {
  "model-picker": `${K}.loss.modelPicker`,
  "default-switches": `${K}.loss.defaultSwitches`,
  "default-stops": `${K}.loss.defaultStops`,
  "uploads-fail": `${K}.loss.uploadsFail`,
  "service-stops": `${K}.loss.serviceStops`,
  stops: `${K}.loss.stops`,
};

const builderModelLabel = (model: string) => `${model} · Builder.io`;

function usageNote(
  t: ReturnType<typeof useT>,
  { id, defaultModel }: BuilderUsage,
): string {
  return defaultModel
    ? t(`${K}.use.aiModelDefaultNote`, {
        model: builderModelLabel(defaultModel.model),
      })
    : t(USAGE_META[id].note);
}

function lossNote(
  t: ReturnType<typeof useT>,
  { loss, defaultModel }: BuilderUsage,
): string {
  return defaultModel?.next
    ? t(LOSS_KEYS[loss], { next: defaultModel.next })
    : t(LOSS_KEYS[loss]);
}

/**
 * Disconnect one Builder.io connection through the action the agent also
 * calls, which checks the caller's role. Throws with the action's message.
 */
function useDisconnectBuilder() {
  const mutation = useActionMutation<
    BuilderDisconnectResult,
    { disconnect: BuilderConnectionScope }
  >("manage-builder-connection" as never);
  return async (scope: BuilderConnectionScope) => {
    await mutation.mutateAsync({ disconnect: scope });
    // Builder status readers outside React Query refresh on this event.
    window.dispatchEvent(new CustomEvent("agent-engine:configured-changed"));
  };
}

function BuilderLogo() {
  return (
    <img
      src={mcpIntegrationLogo("builder-cms")}
      alt=""
      className="size-[18px] object-contain"
    />
  );
}

/** A read of a POST action, keyed like useActionQuery so invalidation refreshes it. */
function usePostActionRead<T>(name: string, enabled: boolean) {
  const params = {};
  return useQuery<T>({
    queryKey: ["action", name, params],
    queryFn: ({ signal }) =>
      callAction<T>(name as never, params as never, { signal }),
    enabled,
  });
}

/**
 * What runs on Builder.io for this viewer, from the same reads the
 * Infrastructure page uses (the storage provider new uploads go to, and the
 * provider that answers each organization service) plus whether the default
 * model runs on Builder.io.
 */
function useBuilderUsages(options: { enabled: boolean; hasOrg: boolean }) {
  const storage = useActionQuery<FileStorageStatus>(
    "get-file-storage" as never,
    undefined,
    { enabled: options.enabled },
  );
  const services = usePostActionRead<ServiceProvidersStatus>(
    "manage-service-providers",
    options.enabled && options.hasOrg,
  );
  const connection = usePostActionRead<BuilderConnectionState>(
    "manage-builder-connection",
    options.enabled,
  );
  const defaultModel = connection.data?.defaultModel;
  const loading =
    storage.isPending ||
    connection.isPending ||
    (options.hasOrg && services.isPending);
  const failed =
    storage.isError ||
    connection.isError ||
    defaultModel?.status === "unknown" ||
    (options.hasOrg && services.isError);
  const usages = builderUsages({
    storageOnBuilder: storage.data
      ? storage.data.activeProvider?.id === "builder"
      : null,
    // No organization means no organization services to check.
    services: options.hasOrg ? (services.data?.services ?? null) : [],
    defaultModel:
      defaultModel && defaultModel.status !== "unknown" ? defaultModel : null,
  });
  return {
    usages,
    loading,
    failed,
    retry: () => {
      void storage.refetch();
      void connection.refetch();
      if (options.hasOrg) void services.refetch();
    },
  };
}

function ConnectButton({
  flow,
  scope,
  onStart,
}: {
  flow: BuilderConnectFlow;
  scope?: BuilderConnectionScope;
  onStart: (scope: BuilderConnectionScope | undefined) => void;
}) {
  const t = useT();
  return (
    <DeferredBuilderConnectPopover
      flow={flow}
      onConnect={(provisionAccount) => {
        onStart(scope);
        flow.start({
          provisionAccount,
          trackingSource: TRACKING_SOURCE,
          ...(scope ? { scope } : {}),
        });
      }}
    >
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={flow.connecting}
      >
        {t(`${K}.connect`)}
      </Button>
    </DeferredBuilderConnectPopover>
  );
}

function ManageMenu({
  flow,
  scope,
  canReconnect,
  onStart,
  onDisconnect,
}: {
  flow: BuilderConnectFlow;
  scope?: BuilderConnectionScope;
  canReconnect: boolean;
  onStart: (scope: BuilderConnectionScope | undefined) => void;
  onDisconnect: () => void;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-builder-manage={scope ?? "legacy"}
        >
          {t(`${K}.manage`)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {canReconnect ? (
          <>
            <DropdownMenuItem
              onSelect={() => {
                onStart(scope);
                flow.start({
                  provisionAccount: false,
                  trackingSource: TRACKING_SOURCE,
                  ...(scope ? { scope } : {}),
                });
              }}
            >
              <IconRefresh className="size-4" aria-hidden="true" />
              {t(`${K}.reconnect`)}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem
          onSelect={onDisconnect}
          className="text-destructive focus:text-destructive"
        >
          <IconUnlink className="size-4" aria-hidden="true" />
          {t(`${K}.disconnect`)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UsageRows({ usages }: { usages: readonly BuilderUsage[] }) {
  const t = useT();
  return (
    <>
      {usages.map((usage) => {
        const meta = USAGE_META[usage.id];
        const Icon = meta.icon;
        return (
          <SettingsRow
            key={usage.id}
            id={`builder-use-${usage.id}`}
            icon={<Icon aria-hidden="true" />}
            label={t(meta.label)}
            description={usageNote(t, usage)}
          />
        );
      })}
    </>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-5 py-4 sm:px-6">
      <Skeleton className="size-8 rounded-md" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

function DisconnectOrgDialog({
  open,
  onOpenChange,
  orgName,
  usages,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgName: string;
  usages: readonly BuilderUsage[];
  loading: boolean;
}) {
  const t = useT();
  const disconnect = useDisconnectBuilder();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      await disconnect("org");
      onOpenChange(false);
    } catch (err) {
      setError(actionErrorMessage(err) ?? t(`${K}.disconnectFailed`));
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`${K}.disconnectTitle`)}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(`${K}.disconnectBody`, { org: orgName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t(`${K}.whatHappens`)}
          </p>
          <ul
            className="flex flex-col divide-y divide-border/60 rounded-lg border border-border/70"
            data-builder-disconnect-effects=""
          >
            {loading ? (
              <li className="px-3 py-2.5">
                <Skeleton className="h-3.5 w-2/3" />
              </li>
            ) : (
              usages.map((usage) => {
                const meta = USAGE_META[usage.id];
                const Icon = meta.icon;
                return (
                  <li key={usage.id} className="flex gap-2.5 px-3 py-2.5">
                    <Icon
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {t(meta.label)}
                      </p>
                      <p className="text-xs leading-5 text-muted-foreground">
                        {lossNote(t, usage)}
                      </p>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </div>
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
            aria-busy={pending}
            onClick={() => void confirm()}
          >
            {pending ? <Spinner aria-hidden="true" /> : null}
            {pending ? t(`${K}.disconnecting`) : t(`${K}.disconnect`)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export interface BuilderIntegrationPageProps {
  context: SettingsPageContext;
}

/**
 * Settings › Integrations › Builder.io: the organization connection owners and
 * admins manage, a member's own connection, and what Builder.io powers
 * (spec §5.4). Connect goes through the scoped Builder OAuth routes and
 * disconnect through `manage-builder-connection`; both enforce the roles.
 */
export function BuilderIntegrationPage({
  context,
}: BuilderIntegrationPageProps) {
  const t = useT();
  const org = useOrg();
  const header = useMemo(
    () => ({
      title: (
        <BreadcrumbTitle
          name="Builder.io"
          mark={
            <BrandMark
              logoUrl={mcpIntegrationLogo("builder-cms")}
              className="size-4 rounded-[3px]"
            />
          }
        />
      ),
    }),
    [],
  );
  useSettingsPageHeader(header);
  const flow = useBuilderConnectFlow({
    provisionAccount: true,
    trackingSource: TRACKING_SOURCE,
  });
  const [startedScope, setStartedScope] = useState<
    BuilderConnectionScope | "legacy" | null
  >(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [personalPending, setPersonalPending] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  // A workspace without an organization has one connection, saved for its
  // only user through the unscoped connect route.
  const solo = context.hasOrganization === false;
  const orgName = org.data?.orgName ?? t(`${K}.orgFallback`);
  const statusKnown = flow.hasFetchedStatus;
  const grants = flow.grants;
  const orgGrant = grants?.org;
  const personalGrant = grants?.personal;
  const active = statusKnown && (flow.configured || flow.effective !== null);
  const usage = useBuilderUsages({ enabled: active, hasOrg: !solo });

  const onStart = (scope: BuilderConnectionScope | undefined) => {
    setRowError(null);
    setStartedScope(scope ?? "legacy");
  };
  const connectingFor = (scope: BuilderConnectionScope | "legacy") =>
    flow.connecting && startedScope === scope;
  const cancelButton = (
    <Button type="button" variant="secondary" size="sm" onClick={flow.cancel}>
      {t("common.cancel")}
    </Button>
  );

  const disconnectingButton = (
    <Button type="button" variant="secondary" size="sm" disabled>
      <Spinner aria-hidden="true" />
      {t(`${K}.disconnecting`)}
    </Button>
  );

  const disconnect = useDisconnectBuilder();
  // Without an organization the one connection is the caller's own, so it
  // disconnects as the personal one too.
  const disconnectPersonal = async () => {
    setPersonalPending(true);
    setRowError(null);
    try {
      await disconnect("personal");
    } catch (err) {
      setRowError(actionErrorMessage(err) ?? t(`${K}.disconnectFailed`));
    } finally {
      setPersonalPending(false);
    }
  };

  const spaceFor = (scope: BuilderConnectionScope) =>
    flow.effective === scope ? flow.orgName : null;

  const orgDescription = orgGrant
    ? orgGrant.needsReconnect
      ? t(`${K}.needsReconnect`)
      : spaceFor("org")
        ? t(`${K}.connectedTo`, { space: spaceFor("org") })
        : t(`${K}.connected`)
    : flow.canConnect.org
      ? t(`${K}.orgNotConnectedAdmin`, { org: orgName })
      : t(`${K}.orgNotConnectedMember`);
  const orgControl = !flow.canConnect.org ? null : connectingFor("org") ? (
    cancelButton
  ) : orgGrant ? (
    <ManageMenu
      flow={flow}
      scope="org"
      canReconnect
      onStart={onStart}
      onDisconnect={() => setDisconnectOpen(true)}
    />
  ) : (
    <ConnectButton flow={flow} scope="org" onStart={onStart} />
  );

  const personalSpace = spaceFor("personal");
  const personalDescription = personalGrant
    ? personalGrant.restricted
      ? t(`${K}.personalRestrictedUnused`)
      : personalGrant.needsReconnect
        ? t(`${K}.needsReconnect`)
        : orgGrant
          ? personalSpace
            ? t(`${K}.personalConnectedToOverOrg`, { space: personalSpace })
            : t(`${K}.personalConnectedOverOrg`)
          : personalSpace
            ? t(`${K}.personalConnectedTo`, { space: personalSpace })
            : t(`${K}.personalConnected`)
    : flow.canConnect.personal
      ? t(`${K}.personalNotConnected`)
      : t(`${K}.personalRestricted`);
  const personalControl = connectingFor("personal") ? (
    cancelButton
  ) : personalPending ? (
    disconnectingButton
  ) : personalGrant ? (
    <ManageMenu
      flow={flow}
      scope="personal"
      canReconnect={flow.canConnect.personal}
      onStart={onStart}
      onDisconnect={() => void disconnectPersonal()}
    />
  ) : flow.canConnect.personal ? (
    <ConnectButton flow={flow} scope="personal" onStart={onStart} />
  ) : null;

  const soloConnected = flow.configured;
  const soloDescription = soloConnected
    ? flow.orgName
      ? t(`${K}.personalConnectedTo`, { space: flow.orgName })
      : t(`${K}.personalConnected`)
    : t(`${K}.personalNotConnected`);
  const soloControl = connectingFor("legacy") ? (
    cancelButton
  ) : personalPending ? (
    disconnectingButton
  ) : soloConnected ? (
    flow.canDisconnect ? (
      <ManageMenu
        flow={flow}
        canReconnect
        onStart={onStart}
        onDisconnect={() => void disconnectPersonal()}
      />
    ) : null
  ) : (
    <ConnectButton flow={flow} onStart={onStart} />
  );

  return (
    <div className="flex flex-col gap-8" data-builder-page="">
      <p className="text-sm leading-[1.6] text-muted-foreground">
        {t("agentChat.settingsShell.integrations.builderDescription")}
      </p>

      <SettingsGroup id="connection" title={t(`${K}.connection`)}>
        {!statusKnown ? (
          <>
            <RowSkeleton />
            {!context.isAdmin && !solo ? <RowSkeleton /> : null}
          </>
        ) : grants === null && !solo ? (
          <SettingsRow
            id="builder-connection-error"
            icon={<BuilderLogo />}
            label={t(`${K}.organization`)}
            description={t(`${K}.grantsFailed`)}
            control={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => flow.retry()}
              >
                {t(`${K}.retry`)}
              </Button>
            }
          />
        ) : solo ? (
          <SettingsRow
            id="builder-personal"
            icon={<BuilderLogo />}
            label={t(`${K}.personal`)}
            description={soloDescription}
            control={soloControl}
          />
        ) : (
          <>
            <SettingsRow
              id="builder-organization"
              icon={<BuilderLogo />}
              label={t(`${K}.organization`)}
              description={orgDescription}
              control={orgControl}
            />
            {/* Spec open question 1: owners and admins connect for the
                organization, so only members can add a personal connection.
                One an admin already has (account activation saves keys
                personally) still shows, so they can remove it. */}
            {!context.isAdmin || personalGrant ? (
              <SettingsRow
                id="builder-personal"
                icon={<BuilderLogo />}
                label={t(`${K}.personal`)}
                description={personalDescription}
                control={personalControl}
              />
            ) : null}
          </>
        )}
      </SettingsGroup>
      {rowError || flow.error ? (
        <p role="alert" className="-mt-6 text-xs text-destructive">
          {rowError ?? flow.error}
        </p>
      ) : null}

      {active ? (
        <div className="flex flex-col gap-2">
          <SettingsGroup id="used-for" title={t(`${K}.usedFor`)}>
            {usage.loading ? (
              <>
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
              </>
            ) : (
              <>
                <UsageRows usages={usage.usages} />
                {usage.failed ? (
                  <SettingsRow
                    id="builder-used-for-error"
                    label={
                      <span role="alert" className="text-destructive">
                        {t(`${K}.usedForLoadFailed`)}
                      </span>
                    }
                    control={
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={usage.retry}
                      >
                        {t(`${K}.retry`)}
                      </Button>
                    }
                  />
                ) : null}
              </>
            )}
          </SettingsGroup>
          {context.isAdmin ? (
            <p className="text-xs leading-5 text-muted-foreground">
              <SentenceWithLink
                text={t(`${K}.usedForFootnote`, { link: SENTENCE_LINK_TOKEN })}
                link={
                  <SettingsPageLink page="infra">
                    {t("agentChat.settingsShell.page.infra")}
                  </SettingsPageLink>
                }
              />
            </p>
          ) : null}
        </div>
      ) : null}

      <DisconnectOrgDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        orgName={orgName}
        usages={usage.usages}
        loading={usage.loading}
      />
    </div>
  );
}
