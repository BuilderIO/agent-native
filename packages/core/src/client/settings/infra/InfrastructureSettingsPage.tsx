import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import {
  IconBox,
  IconBrowser,
  IconCode,
  IconCpu,
  IconDatabase,
  IconKey,
  IconMicrophone,
  IconPalette,
  IconPhoto,
  IconSearch,
  IconServer,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import type {
  ServiceProviderServiceStatus,
  ServiceProvidersStatus,
} from "../../../agent/actions/manage-service-providers.js";
import type { FileStorageStatus } from "../../../file-upload/storage-settings.js";
import type {
  WorkspaceBuilderOnlyServiceId,
  WorkspaceProviderServiceId,
} from "../../../onboarding/types.js";
import { WORKSPACE_SERVICES } from "../../../onboarding/workspace-services.js";
import type {
  InfrastructureSetupTag,
  InfrastructureStatus,
} from "../../../server/infrastructure-status.js";
import type { AgentProviderId } from "../../agent-provider-catalog.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { useFormatters, useT } from "../../i18n.js";
import { callAction, useActionQuery } from "../../use-action.js";
import { ServiceKeyDialog } from "../api-keys/ApiKeyDialogs.js";
import { DeferredBuilderConnectPopover } from "../deferred-builder-connect-popover.js";
import type { ModelProvidersListing } from "../model/model-page-state.js";
import { ProviderDialog } from "../model/ProviderDialog.js";
import { SettingsGroup, SettingsRow } from "../SettingsRow.js";
import { useSettingsShell } from "../shell/context.js";
import type { SettingsPageProps } from "../shell/registry.js";
import {
  fileStorageProviderPreset,
  StorageSettingsForm,
} from "../StorageSettingsForm.js";
import {
  useBuilderConnectFlow,
  type BuilderConnectFlow,
} from "../useBuilderStatus.js";
import {
  EnvironmentDialog,
  type EnvironmentDialogId,
} from "./EnvironmentDialogs.js";
import {
  AGENT_PROVIDER_LOGOS,
  BUILDER_LABEL,
  DATABASE_PROVIDER_LABELS,
  DATABASE_PROVIDER_LOGOS,
  HOSTING_PLATFORM_LABELS,
  HOSTING_PLATFORM_LOGOS,
  SERVICE_PROVIDER_AGENT_IDS,
  SERVICE_PROVIDER_API_KEY_NAMES,
  SERVICE_PROVIDER_LABELS,
  aiModelSources,
  appAddress,
  optimisticServiceStatus,
  storageSource,
  variablesSummary,
  type ServiceId,
  type ServiceProviderId,
} from "./infra-page-state.js";
import { BrandLogo, ServiceProviderLogo } from "./logos.js";
import { ServiceDialog } from "./ServiceDialog.js";

const K = "agentChat.settingsInfra.";
const SERVICES_QUERY_KEY = ["action", "manage-service-providers", {}] as const;

type Translate = ReturnType<typeof useT>;

type ServiceRowMeta = {
  labelKey: string;
  whyKey: string;
  icon: typeof IconMicrophone;
};

/**
 * Copy and icons for each shared service. Rows render in
 * `WORKSPACE_SERVICES` order, the list first-run setup also reads, and these
 * records are keyed by its ids so a new service needs a row here to compile.
 */
const PROVIDER_SERVICES: Record<
  WorkspaceProviderServiceId,
  ServiceRowMeta & { useKey: string }
> = {
  voice: {
    labelKey: `${K}voice`,
    useKey: `${K}useVoice`,
    whyKey: `${K}whyVoice`,
    icon: IconMicrophone,
  },
  images: {
    labelKey: `${K}images`,
    useKey: `${K}useImages`,
    whyKey: `${K}whyImages`,
    icon: IconPhoto,
  },
  embeddings: {
    labelKey: `${K}embeddings`,
    useKey: `${K}useEmbeddings`,
    whyKey: `${K}whyEmbeddings`,
    icon: IconSearch,
  },
};

/** Services with no bring-your-own path; `rowId` is each row's search anchor. */
const BUILDER_ONLY_SERVICES: Record<
  WorkspaceBuilderOnlyServiceId,
  ServiceRowMeta & { rowId: string }
> = {
  "design-system-intelligence": {
    rowId: "design-system-intelligence",
    labelKey: `${K}designSystem`,
    whyKey: `${K}whyDesignSystem`,
    icon: IconPalette,
  },
  "background-agents": {
    rowId: "background",
    labelKey: "agentChat.settingsShell.search.backgroundAgents",
    whyKey: `${K}whyBackground`,
    icon: IconCode,
  },
  "browser-automation": {
    rowId: "browser-automation",
    labelKey: "agentChat.settingsShell.search.browserAutomation",
    whyKey: `${K}whyBrowser`,
    icon: IconBrowser,
  },
};

type ServiceKeyDialog =
  | { mode: "add-from-service"; service: ServiceId; provider: AgentProviderId }
  | { mode: "manage"; provider: AgentProviderId };

/** A service provider's key that is an ordinary API key, like Voyage's. */
type ServiceApiKeyDialog =
  | {
      mode: "add";
      keyName: string;
      service: ServiceId;
      provider: ServiceProviderId;
    }
  | { mode: "manage"; keyName: string };

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

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Settings › Organization › Infrastructure (spec §5.14), owners and admins
 * only: Builder.io, the services and who powers each, and the read-only
 * environment. Every control writes through the action the agent also calls.
 */
export function InfrastructureSettingsPage({ context }: SettingsPageProps) {
  const hasOrg = context.hasOrganization !== false;
  const infra = useActionQuery<InfrastructureStatus>(
    "get-infrastructure-status" as never,
  );
  const storage = useActionQuery<FileStorageStatus>(
    "get-file-storage" as never,
  );
  const listing = useActionQuery<ModelProvidersListing>(
    "list-model-providers" as never,
  );
  const services = usePostActionRead<ServiceProvidersStatus>(
    "manage-service-providers",
    hasOrg,
  );
  const flow = useBuilderConnectFlow({
    provisionAccount: true,
    trackingSource: "settings_infrastructure",
  });

  const settled = (query: { data?: unknown; isError: boolean }) =>
    query.data !== undefined || query.isError;
  if (
    !settled(infra) ||
    !settled(storage) ||
    !settled(listing) ||
    (hasOrg && !settled(services)) ||
    !flow.hasFetchedStatus
  ) {
    return <InfrastructurePageSkeleton />;
  }

  return (
    <InfrastructurePageContent
      hasOrg={hasOrg}
      flow={flow}
      infra={infra}
      storage={storage}
      listing={listing}
      services={services}
    />
  );
}

interface QueryState<T> {
  data?: T;
  isError: boolean;
  refetch: () => unknown;
}

function InfrastructurePageContent({
  hasOrg,
  flow,
  infra,
  storage,
  listing,
  services,
}: {
  hasOrg: boolean;
  flow: BuilderConnectFlow;
  infra: QueryState<InfrastructureStatus>;
  storage: QueryState<FileStorageStatus>;
  listing: QueryState<ModelProvidersListing>;
  services: QueryState<ServiceProvidersStatus>;
}) {
  const t = useT();
  const formatters = useFormatters();
  const queryClient = useQueryClient();
  const { navigate } = useSettingsShell();
  const [storageOpen, setStorageOpen] = useState(false);
  const [serviceOpen, setServiceOpen] = useState<ServiceId | null>(null);
  const [keyDialog, setKeyDialog] = useState<ServiceKeyDialog | null>(null);
  const [apiKeyDialog, setApiKeyDialog] = useState<ServiceApiKeyDialog | null>(
    null,
  );
  const [environmentOpen, setEnvironmentOpen] =
    useState<EnvironmentDialogId | null>(null);

  // Owners and admins connect Builder.io for the organization (open question
  // 8.1.1); a deploy-level key also powers every service.
  const builderConnected = hasOrg
    ? (!!flow.grants?.org && !flow.grants.org.needsReconnect) ||
      flow.effective === "workspace" ||
      flow.effective === "env"
    : flow.configured;
  const builderUnknown = hasOrg && flow.grants === null;
  const tags = infra.data?.setupTags;

  // The row changes before the server answers and rolls back on failure. The
  // service dialog awaits the write so a failure stays in the dialog; a write
  // that follows a key dialog has no dialog left open, so it reports by toast.
  const setService = async (
    service: ServiceId,
    provider: ServiceProviderId,
  ): Promise<void> => {
    const previous =
      queryClient.getQueryData<ServiceProvidersStatus>(SERVICES_QUERY_KEY);
    void queryClient.cancelQueries({ queryKey: SERVICES_QUERY_KEY });
    if (previous) {
      queryClient.setQueryData(
        SERVICES_QUERY_KEY,
        optimisticServiceStatus(previous, service, provider),
      );
    }
    try {
      const result = await callAction<ServiceProvidersStatus>(
        "manage-service-providers" as never,
        { service, provider } as never,
      );
      queryClient.setQueryData(SERVICES_QUERY_KEY, result);
      toast.success(
        t(`${K}serviceSaved`, {
          service: t(PROVIDER_SERVICES[service].labelKey),
          provider: SERVICE_PROVIDER_LABELS[provider],
        }),
      );
      if (result.reindexRequired) toast(t(`${K}reindex`));
    } catch (cause) {
      if (previous) queryClient.setQueryData(SERVICES_QUERY_KEY, previous);
      throw cause;
    }
  };

  const setServiceAfterKey = (
    service: ServiceId,
    provider: ServiceProviderId,
  ) => {
    setService(service, provider).catch((cause: unknown) => {
      toast.error(
        t(`${K}serviceSaveFailed`, {
          service: t(PROVIDER_SERVICES[service].labelKey),
        }),
        { description: errorMessage(cause) },
      );
    });
  };

  const openKeyForService = (
    service: ServiceId,
    provider: ServiceProviderId,
  ) => {
    const agentProvider = SERVICE_PROVIDER_AGENT_IDS[provider];
    setServiceOpen(null);
    if (!agentProvider) {
      const keyName = SERVICE_PROVIDER_API_KEY_NAMES[provider];
      if (keyName) {
        setApiKeyDialog({ mode: "add", keyName, service, provider });
      }
      return;
    }
    setKeyDialog({
      mode: "add-from-service",
      service,
      provider: agentProvider,
    });
  };

  const manageKey = (provider: ServiceProviderId) => {
    const agentProvider = SERVICE_PROVIDER_AGENT_IDS[provider];
    setServiceOpen(null);
    if (!agentProvider) {
      const keyName = SERVICE_PROVIDER_API_KEY_NAMES[provider];
      if (keyName) setApiKeyDialog({ mode: "manage", keyName });
      return;
    }
    setKeyDialog({ mode: "manage", provider: agentProvider });
  };

  const tag = (value: InfrastructureSetupTag | null | undefined) =>
    value ? (
      <Badge variant="outline" data-setup-tag={value}>
        {value === "required" ? t(`${K}required`) : t(`${K}recommended`)}
      </Badge>
    ) : undefined;
  const rowDescription = (source: string, use: string) =>
    t(`${K}rowDescription`, { source, use });
  const failedRow = (retry: () => unknown) => ({
    description: (
      <span className="text-destructive">{t(`${K}loadFailed`)}</span>
    ),
    control: (
      <RowButton onClick={() => void retry()}>{t(`${K}retry`)}</RowButton>
    ),
  });

  // Builder.io is the recommended way to power every service, so while it can
  // be connected it heads the page with the page's one primary action, and
  // each Builder.io-only service offers the same connect in place.
  const canConnectBuilder = !hasOrg || flow.canConnect.org;
  const recommendBuilder =
    !builderUnknown && !builderConnected && canConnectBuilder;
  const connectBuilder = (variant: "default" | "outline", label: string) => (
    <DeferredBuilderConnectPopover
      flow={flow}
      onConnect={(provisionAccount) =>
        flow.start({
          provisionAccount,
          ...(hasOrg ? { scope: "org" as const } : {}),
        })
      }
    >
      <Button
        type="button"
        variant={variant}
        size="sm"
        disabled={flow.connecting}
      >
        {flow.connecting ? <Spinner aria-hidden /> : null}
        {flow.connecting ? t(`${K}connecting`) : label}
      </Button>
    </DeferredBuilderConnectPopover>
  );

  // Setup › Builder.io
  let builderDescription: ReactNode;
  let builderControl: ReactNode = null;
  if (builderUnknown) {
    builderDescription = t(`${K}builderUnknown`);
    builderControl = (
      <RowButton onClick={() => navigate("integrations", "builder")}>
        {t(`${K}manage`)}
      </RowButton>
    );
  } else if (builderConnected) {
    builderDescription = t(`${K}builderConnected`);
    builderControl = (
      <RowButton onClick={() => navigate("integrations", "builder")}>
        {t(`${K}manage`)}
      </RowButton>
    );
  } else if (recommendBuilder) {
    builderDescription = t(`${K}builderRecommended`);
    builderControl = connectBuilder("default", t(`${K}connect`));
  } else {
    builderDescription = t(`${K}builderNotConnected`);
  }

  // Services › AI model
  const aiModelRow = (() => {
    if (!listing.data) return failedRow(listing.refetch);
    const sources = aiModelSources(listing.data, builderConnected);
    const setUp = sources.labels.length > 0;
    return {
      icon:
        sources.lead === "builder" ? (
          <BrandLogo logoId="builder-cms" />
        ) : (
          <BrandLogo
            logoId={sources.lead ? AGENT_PROVIDER_LOGOS[sources.lead] : null}
            fallback={IconCpu}
          />
        ),
      status: setUp ? undefined : tag(tags?.model ?? "required"),
      description: rowDescription(
        setUp ? formatters.formatList(sources.labels) : t(`${K}notSetUp`),
        t(`${K}useEveryApp`),
      ),
      control: (
        <RowButton onClick={() => navigate("model")}>
          {setUp ? t(`${K}manage`) : t(`${K}setUp`)}
        </RowButton>
      ),
    };
  })();

  // Services › File uploads and storage
  const storageRow = (() => {
    if (!storage.data) return failedRow(storage.refetch);
    const source = storageSource(storage.data);
    const preset =
      source.kind === "bucket"
        ? fileStorageProviderPreset(source.provider)
        : null;
    const text =
      source.kind === "bucket"
        ? t(`${K}storageBucket`, {
            provider:
              preset?.name ?? t("agentChat.settings.storage.providerOther"),
            bucket: source.bucket,
          })
        : source.kind === "builder"
          ? BUILDER_LABEL
          : t(`${K}notSetUp`);
    const Icon = preset?.icon;
    return {
      icon:
        source.kind === "builder" ? (
          <BrandLogo logoId="builder-cms" />
        ) : Icon ? (
          <Icon aria-hidden />
        ) : (
          <IconBox aria-hidden />
        ),
      status: source.kind === "none" ? tag(tags?.storage) : undefined,
      description: rowDescription(text, t(`${K}useUploads`)),
      control: (
        <RowButton onClick={() => setStorageOpen(true)}>
          {source.kind === "none" ? t(`${K}setUp`) : t(`${K}manage`)}
        </RowButton>
      ),
    };
  })();

  const serviceRow = (id: WorkspaceProviderServiceId) => {
    const entry = PROVIDER_SERVICES[id];
    if (!services.data) return failedRow(services.refetch);
    const status = services.data.services.find((item) => item.service === id);
    if (!status) return failedRow(services.refetch);
    const provider = status.effectiveProvider;
    return {
      icon: provider ? (
        <ServiceProviderLogo provider={provider} />
      ) : (
        <entry.icon aria-hidden />
      ),
      status: provider ? undefined : tag(tags?.[id]),
      description: rowDescription(
        provider ? SERVICE_PROVIDER_LABELS[provider] : t(`${K}notSetUp`),
        t(entry.useKey),
      ),
      control: (
        <RowButton onClick={() => setServiceOpen(id)}>
          {provider ? t(`${K}manage`) : t(`${K}setUp`)}
        </RowButton>
      ),
    };
  };

  const openService: ServiceProviderServiceStatus | null =
    (serviceOpen &&
      services.data?.services.find((item) => item.service === serviceOpen)) ||
    null;
  const openServiceMeta = serviceOpen ? PROVIDER_SERVICES[serviceOpen] : null;

  return (
    <div className="flex flex-col gap-8" data-infrastructure-settings="">
      <SettingsGroup
        id="setup"
        title={recommendBuilder ? t(`${K}recommended`) : t(`${K}setup`)}
      >
        <SettingsRow
          id="builder"
          icon={<BrandLogo logoId="builder-cms" />}
          label={BUILDER_LABEL}
          description={builderDescription}
          control={builderControl}
        >
          {flow.error ? (
            <p role="alert" className="text-sm text-destructive">
              {flow.error}
            </p>
          ) : null}
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup id="services" title={t(`${K}services`)}>
        {WORKSPACE_SERVICES.map((service) => {
          switch (service.kind) {
            case "model":
              return (
                <SettingsRow
                  key={service.id}
                  id="ai-model"
                  label={t(`${K}aiModel`)}
                  {...aiModelRow}
                />
              );
            case "storage":
              return (
                <SettingsRow
                  key={service.id}
                  id="uploads"
                  label={t("agentChat.settingsShell.search.fileUploads")}
                  {...storageRow}
                />
              );
            case "provider":
              return hasOrg ? (
                <SettingsRow
                  key={service.id}
                  id={service.id}
                  label={t(PROVIDER_SERVICES[service.id].labelKey)}
                  {...serviceRow(service.id)}
                />
              ) : null;
            case "builder-only": {
              const entry = BUILDER_ONLY_SERVICES[service.id];
              return (
                <SettingsRow
                  key={service.id}
                  id={entry.rowId}
                  icon={
                    builderConnected ? (
                      <BrandLogo logoId="builder-cms" />
                    ) : (
                      <entry.icon aria-hidden />
                    )
                  }
                  label={t(entry.labelKey)}
                  status={
                    builderConnected ? undefined : (
                      <Badge variant="outline" data-builder-only="">
                        {t(`${K}builderOnly`)}
                      </Badge>
                    )
                  }
                  description={rowDescription(
                    builderConnected
                      ? BUILDER_LABEL
                      : t(`${K}availableWithBuilder`),
                    t(entry.whyKey),
                  )}
                  control={
                    recommendBuilder
                      ? connectBuilder(
                          "outline",
                          t("agentChat.setup.connectBuilder"),
                        )
                      : undefined
                  }
                />
              );
            }
          }
        })}
      </SettingsGroup>

      <EnvironmentGroup
        infra={infra}
        onView={setEnvironmentOpen}
        t={t}
        formatList={(value) => formatters.formatList(value)}
      />

      <Dialog open={storageOpen} onOpenChange={setStorageOpen}>
        {storageOpen ? (
          <DialogContent
            className="max-w-2xl"
            closeLabel={t(`${K}close`)}
            data-storage-dialog=""
          >
            <DialogHeader>
              <DialogTitle>{t(`${K}storageTitle`)}</DialogTitle>
              <DialogDescription>{t(`${K}storageIntro`)}</DialogDescription>
            </DialogHeader>
            <StorageSettingsForm
              onCancel={() => setStorageOpen(false)}
              onSaved={(status) => {
                setStorageOpen(false);
                toast.success(
                  t("agentChat.settings.storage.savedNotice", {
                    bucket: status.bucket ?? "",
                  }),
                );
              }}
              onCleared={(status) => {
                setStorageOpen(false);
                toast.success(
                  status.builderUploadConfigured
                    ? t("agentChat.settings.storage.clearedBuilder")
                    : t("agentChat.settings.storage.cleared"),
                );
              }}
            />
          </DialogContent>
        ) : null}
      </Dialog>

      <ServiceDialog
        service={openService}
        label={openServiceMeta ? t(openServiceMeta.labelKey) : ""}
        why={openServiceMeta ? t(openServiceMeta.whyKey) : ""}
        onOpenChange={(open) => {
          if (!open) setServiceOpen(null);
        }}
        onSave={(provider) =>
          serviceOpen ? setService(serviceOpen, provider) : Promise.resolve()
        }
        onAddKey={(provider) => {
          if (serviceOpen) openKeyForService(serviceOpen, provider);
        }}
        onManageKey={manageKey}
      />

      <ProviderDialog
        open={keyDialog !== null}
        onOpenChange={(open) => {
          if (!open) setKeyDialog(null);
        }}
        mode={keyDialog?.mode ?? "manage"}
        {...(keyDialog
          ? {
              provider: keyDialog.provider,
              ...(keyDialog.mode === "manage"
                ? { scope: hasOrg ? ("org" as const) : ("user" as const) }
                : {
                    serviceLabel: t(
                      PROVIDER_SERVICES[keyDialog.service].labelKey,
                    ),
                  }),
            }
          : {})}
        onSaved={({ provider }) => {
          if (keyDialog?.mode !== "add-from-service") return;
          const serviceProvider = (
            Object.keys(SERVICE_PROVIDER_AGENT_IDS) as ServiceProviderId[]
          ).find((id) => SERVICE_PROVIDER_AGENT_IDS[id] === provider);
          if (serviceProvider) {
            setServiceAfterKey(keyDialog.service, serviceProvider);
          }
        }}
      />

      <ServiceKeyDialog
        open={apiKeyDialog !== null}
        onOpenChange={(open) => {
          if (!open) setApiKeyDialog(null);
        }}
        keyName={apiKeyDialog?.keyName ?? ""}
        mode={apiKeyDialog?.mode ?? "add"}
        onSaved={() => {
          if (apiKeyDialog?.mode === "add") {
            setServiceAfterKey(apiKeyDialog.service, apiKeyDialog.provider);
          }
        }}
      />

      {infra.data ? (
        <EnvironmentDialog
          open={environmentOpen}
          status={infra.data}
          hostLabel={hostingLabel(infra.data, t)}
          onOpenChange={(open) => {
            if (!open) setEnvironmentOpen(null);
          }}
        />
      ) : null}
    </div>
  );
}

function hostingLabel(status: InfrastructureStatus, t: Translate): string {
  const platform = status.hosting.platform;
  if (platform === "local") return t(`${K}hostThisComputer`);
  if (platform === "node") return t(`${K}hostOwnServer`);
  return HOSTING_PLATFORM_LABELS[platform] ?? t(`${K}hostOwnServer`);
}

function EnvironmentGroup({
  infra,
  onView,
  t,
  formatList,
}: {
  infra: QueryState<InfrastructureStatus>;
  onView: (id: EnvironmentDialogId) => void;
  t: Translate;
  formatList: (value: string[]) => string;
}) {
  const view = (id: EnvironmentDialogId) => (
    <RowButton onClick={() => onView(id)}>{t(`${K}view`)}</RowButton>
  );
  const status = infra.data;
  if (!status) {
    const failed = (
      <span className="text-destructive">{t(`${K}loadFailed`)}</span>
    );
    const retry = (
      <RowButton onClick={() => void infra.refetch()}>
        {t(`${K}retry`)}
      </RowButton>
    );
    return (
      <SettingsGroup id="environment" title={t(`${K}environment`)}>
        <SettingsRow
          id="database"
          label={t("agentChat.settingsShell.search.database")}
          description={failed}
          control={retry}
        />
        <SettingsRow
          id="hosting"
          label={t("agentChat.settingsShell.search.hosting")}
          description={failed}
        />
        <SettingsRow
          id="variables"
          label={t(`${K}variables`)}
          description={failed}
        />
      </SettingsGroup>
    );
  }

  const { database, hosting } = status;
  const databaseName = database.provider
    ? DATABASE_PROVIDER_LABELS[database.provider]
    : null;
  const databaseDescription = database.local
    ? t(`${K}databaseLocal`, { name: databaseName })
    : database.configured && databaseName
      ? status.workspace
        ? t(`${K}databaseHosted`, { name: databaseName })
        : t(`${K}databaseHostedSingle`, { name: databaseName })
      : t(`${K}databaseMissing`);

  const host = hostingLabel(status, t);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const firstApp = hosting.apps[0];
  const hostingDescription = status.workspace
    ? t(`${K}hostingWorkspace`, { host })
    : firstApp
      ? t(`${K}hostingSingle`, {
          host,
          address: appAddress(firstApp, hosting.gatewayUrl, origin),
        })
      : t(`${K}hostingPlain`, { host });

  const { required, missing } = variablesSummary(status.variables);
  const variablesDescription = missing.length
    ? t(`${K}variablesMissing`, { keys: formatList(missing) })
    : t(`${K}variablesSet`, {
        keys: formatList(required.map((variable) => variable.key)),
      });

  return (
    <SettingsGroup id="environment" title={t(`${K}environment`)}>
      <SettingsRow
        id="database"
        icon={
          <BrandLogo
            logoId={
              database.provider
                ? DATABASE_PROVIDER_LOGOS[database.provider]
                : null
            }
            fallback={IconDatabase}
          />
        }
        label={t("agentChat.settingsShell.search.database")}
        description={databaseDescription}
        control={view("database")}
      />
      <SettingsRow
        id="hosting"
        icon={
          <BrandLogo
            logoId={HOSTING_PLATFORM_LOGOS[hosting.platform]}
            fallback={IconServer}
          />
        }
        label={t("agentChat.settingsShell.search.hosting")}
        description={hostingDescription}
        control={view("hosting")}
      />
      <SettingsRow
        id="variables"
        icon={<IconKey aria-hidden />}
        label={t(`${K}variables`)}
        status={
          missing.length ? (
            <Badge variant="outline">{t(`${K}required`)}</Badge>
          ) : undefined
        }
        description={variablesDescription}
        control={view("variables")}
      />
    </SettingsGroup>
  );
}

function RowButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick}>
      {children}
    </Button>
  );
}

function InfrastructurePageSkeleton() {
  const t = useT();
  const group = (rows: number, key: string) => (
    <div key={key} className="grid gap-2.5">
      <Skeleton className="h-4 w-24" />
      <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6"
          >
            <div className="flex flex-1 gap-3">
              <Skeleton className="size-8 shrink-0 rounded-md" />
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-64" />
              </div>
            </div>
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div
      className="flex flex-col gap-8"
      aria-busy="true"
      aria-label={t("agentChat.settingsShell.loading")}
      data-infrastructure-skeleton=""
    >
      {group(1, "setup")}
      {group(8, "services")}
      {group(3, "environment")}
    </div>
  );
}
