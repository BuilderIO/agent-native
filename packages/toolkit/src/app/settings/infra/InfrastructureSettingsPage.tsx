import type {
  ServiceProviderServiceStatus,
  ServiceProvidersStatus,
} from "@agent-native/core/agent/actions/manage-service-providers";
import type { AgentProviderId } from "@agent-native/core/client/agent-provider-catalog";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import type { FileStorageStatus } from "@agent-native/core/file-upload/storage-settings";
import type {
  WorkspaceBuilderIncludedServiceId,
  WorkspaceBuilderOnlyServiceId,
  WorkspaceProviderServiceId,
} from "@agent-native/core/onboarding/types";
import { WORKSPACE_SERVICES } from "@agent-native/core/onboarding/workspace-services";
import type {
  InfrastructureSetupTag,
  InfrastructureStatus,
} from "@agent-native/core/server/infrastructure-status";
import {
  type ModelRow,
  type RowIcon,
  rowIdSegment,
} from "@agent-native/design-system/model";
import {
  combineFragments,
  type ModelFragment,
  ModelSurface,
} from "@agent-native/toolkit/design-system";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { Switch } from "@agent-native/toolkit/ui/switch";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ServiceKeyDialog } from "../api-keys/ApiKeyDialogs.js";
import { DeferredBuilderConnectPopover } from "../deferred-builder-connect-popover.js";
import type { ModelProvidersListing } from "../model/model-page-state.js";
import { ProviderDialog } from "../model/ProviderDialog.js";
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
  SERVICE_PROVIDER_LOGOS,
  aiModelSources,
  appAddress,
  optimisticServiceStatus,
  storageSource,
  variablesSummary,
  type ServiceId,
  type ServiceProviderId,
} from "./infra-page-state.js";
import { brandLogoUrl } from "./logos.js";
import { ServiceDialog } from "./ServiceDialog.js";

const K = "agentChat.settingsInfra.";
const SERVICES_QUERY_KEY = ["action", "manage-service-providers", {}] as const;

type Translate = ReturnType<typeof useT>;

type ServiceRowMeta = {
  labelKey: string;
  whyKey: string;
  symbol: string;
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
    symbol: "microphone",
  },
  images: {
    labelKey: `${K}images`,
    useKey: `${K}useImages`,
    whyKey: `${K}whyImages`,
    symbol: "photo",
  },
  embeddings: {
    labelKey: `${K}embeddings`,
    useKey: `${K}useEmbeddings`,
    whyKey: `${K}whyEmbeddings`,
    symbol: "search",
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
    symbol: "palette",
  },
  "background-agents": {
    rowId: "background",
    labelKey: "agentChat.settingsShell.search.backgroundAgents",
    whyKey: `${K}whyBackground`,
    symbol: "code",
  },
  "browser-automation": {
    rowId: "browser-automation",
    labelKey: "agentChat.settingsShell.search.browserAutomation",
    whyKey: `${K}whyBrowser`,
    symbol: "browser",
  },
};

/** Services Builder includes that also have a bring-your-own path. */
const BUILDER_INCLUDED_SERVICES: Record<
  WorkspaceBuilderIncludedServiceId,
  ServiceRowMeta & { rowId: string }
> = {
  "web-search": {
    rowId: "web-search",
    labelKey: "agentChat.settingsShell.search.webSearch",
    whyKey: `${K}whyWebSearch`,
    symbol: "search",
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

function brandIcon(logoId: string | null | undefined, symbol: string): RowIcon {
  const src = brandLogoUrl(logoId);
  return src ? { kind: "image", src } : { kind: "symbol", key: symbol };
}

const BUILDER_ICON = brandIcon("builder-cms", "cube");

type InfraRowControl =
  | { button: string; segment: string; onClick: () => void }
  | { content: ReactNode };

interface InfraRow {
  icon?: RowIcon | undefined;
  description?: string | undefined;
  descriptionContent?: ReactNode;
  badge?: string | undefined;
  status?: ReactNode;
  control?: InfraRowControl | undefined;
  detail?: ReactNode;
}

function infraRow(
  id: string,
  anchor: string,
  label: string,
  row: InfraRow,
): ModelFragment {
  const regions: Record<string, string> = {};
  const slots: Record<string, ReactNode> = {};
  const region = (name: string, content: ReactNode) => {
    if (content === undefined || content === null) return;
    regions[name] = `${id}:${name}`;
    slots[`${id}:${name}`] = content;
  };
  region("description", row.descriptionContent);
  region("status", row.status);
  region("detail", row.detail);
  const control = row.control;
  let slot: string | undefined;
  let rows: ModelRow[] | undefined;
  const actions: Record<string, () => void> = {};
  if (control && "button" in control) {
    const buttonId = `${id}.${control.segment}`;
    rows = [
      {
        id: buttonId,
        part: "button",
        kind: "action",
        label: control.button,
        effect: { kind: "action", effectId: buttonId },
      },
    ];
    actions[buttonId] = control.onClick;
  } else if (control) {
    slot = `${id}:control`;
    slots[slot] = control.content;
  }
  return {
    rows: [
      {
        id,
        part: "settings.row",
        label,
        anchor,
        ...(row.icon ? { icon: row.icon } : {}),
        ...(row.description ? { description: row.description } : {}),
        ...(row.badge
          ? { state: { badge: { kind: "label" as const, value: row.badge } } }
          : {}),
        ...(Object.keys(regions).length > 0 ? { regions } : {}),
        ...(slot ? { slot } : {}),
        ...(rows ? { rows } : {}),
      },
    ],
    actions,
    slots,
  };
}

function infraGroup(
  id: string,
  anchor: string,
  label: string,
  fragments: readonly ModelFragment[],
): ModelFragment {
  const combined = combineFragments(fragments);
  return {
    rows: [{ id, part: "settings.group", label, anchor, rows: combined.rows }],
    actions: combined.actions,
    slots: combined.slots,
  };
}

/**
 * Settings › Organization › Infrastructure (spec §5.14), owners and admins
 * only: Builder.io, the services and who powers each, and the read-only
 * environment. Every control writes through the action the agent also calls.
 */
export function InfrastructureSettingsPage({ context }: SettingsPageProps) {
  const hasOrg = context.hasOrganization !== false;
  const queryClient = useQueryClient();
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
    onConnected: () =>
      queryClient.invalidateQueries({
        queryKey: ["action", "get-file-storage"],
      }),
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
  const [storageBuilderReconnectPending, setStorageBuilderReconnectPending] =
    useState(false);
  const [serviceOpen, setServiceOpen] = useState<ServiceId | null>(null);
  const [keyDialog, setKeyDialog] = useState<ServiceKeyDialog | null>(null);
  const [apiKeyDialog, setApiKeyDialog] = useState<ServiceApiKeyDialog | null>(
    null,
  );
  const [environmentOpen, setEnvironmentOpen] =
    useState<EnvironmentDialogId | null>(null);
  const [semanticSearchSaving, setSemanticSearchSaving] = useState(false);
  // The value a failed change tried to set. The server may have saved it
  // before failing, so the row offers to finish the change.
  const [semanticSearchRetry, setSemanticSearchRetry] = useState<
    boolean | null
  >(null);

  // Owners and admins connect Builder.io for the organization (open question
  // 8.1.1); a deploy-level key also powers every service.
  const builderConnected = hasOrg
    ? (!!flow.grants?.org && !flow.grants.org.needsReconnect) ||
      flow.effective === "workspace" ||
      flow.effective === "env"
    : flow.configured;
  const builderUnknown = hasOrg && flow.grants === null;
  const tags = infra.data?.setupTags;
  const storageSourceStatus = storage.data ? storageSource(storage.data) : null;
  const storageProviderStatusUnknown =
    storage.data?.activeProviderUnavailable === true;
  const storageBuilderGrantMissing =
    storageSourceStatus?.kind === "none" &&
    builderConnected &&
    storage.data?.builderUploadConfigured === false;
  const storageBuilderStatusUnknown =
    storageSourceStatus?.kind === "none" &&
    builderConnected &&
    storage.data?.builderUploadConfigured === null;

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

  // Like setService, but the switch has no dialog to hold a failure.
  const setSemanticSearch = async (enabled: boolean): Promise<void> => {
    const previous =
      queryClient.getQueryData<ServiceProvidersStatus>(SERVICES_QUERY_KEY);
    void queryClient.cancelQueries({ queryKey: SERVICES_QUERY_KEY });
    if (previous?.semanticSearch) {
      queryClient.setQueryData<ServiceProvidersStatus>(SERVICES_QUERY_KEY, {
        ...previous,
        semanticSearch: { ...previous.semanticSearch, enabled },
      });
    }
    setSemanticSearchSaving(true);
    try {
      const result = await callAction<ServiceProvidersStatus>(
        "manage-service-providers" as never,
        { semanticSearch: enabled } as never,
      );
      queryClient.setQueryData(SERVICES_QUERY_KEY, result);
      setSemanticSearchRetry(null);
      toast.success(
        t(
          enabled
            ? `${K}semanticSearchTurnedOn`
            : `${K}semanticSearchTurnedOff`,
        ),
      );
    } catch (cause) {
      if (previous) queryClient.setQueryData(SERVICES_QUERY_KEY, previous);
      // The server may have saved the setting before failing, so read it.
      void queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY });
      setSemanticSearchRetry(enabled);
      toast.error(t(`${K}semanticSearchSaveFailed`), {
        description: errorMessage(cause),
      });
    } finally {
      setSemanticSearchSaving(false);
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
  const failedRow = (retry: () => unknown): InfraRow => ({
    description: t(`${K}loadFailed`),
    descriptionContent: (
      <span className="text-destructive">{t(`${K}loadFailed`)}</span>
    ),
    control: {
      button: t(`${K}retry`),
      segment: "retry",
      onClick: () => void retry(),
    },
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
        {flow.connecting ? t("agentChat.composer.connectingBuilder") : label}
      </Button>
    </DeferredBuilderConnectPopover>
  );

  // Setup › Builder.io
  let builderDescription: string;
  let builderControl: InfraRowControl | undefined;
  if (builderUnknown) {
    builderDescription = t(`${K}builderUnknown`);
    builderControl = {
      content: (
        <div className="flex flex-wrap gap-2">
          <RowButton onClick={() => navigate("integrations", "builder")}>
            {t(`${K}manage`)}
          </RowButton>
          <RowButton onClick={() => void flow.retry()}>
            {t(`${K}retry`)}
          </RowButton>
        </div>
      ),
    };
  } else if (builderConnected) {
    builderDescription = t(`${K}builderConnected`);
    builderControl = {
      button: t(`${K}manage`),
      segment: "manage",
      onClick: () => navigate("integrations", "builder"),
    };
  } else if (recommendBuilder) {
    builderDescription = t(`${K}builderRecommended`);
    builderControl = {
      content: connectBuilder("default", t("agentChat.setup.connectBuilder")),
    };
  } else {
    builderDescription = t(`${K}builderNotConnected`);
  }

  // Services › AI model
  const aiModelRow = ((): InfraRow => {
    if (!listing.data) return failedRow(listing.refetch);
    const sources = aiModelSources(listing.data, builderConnected);
    const setUp = sources.labels.length > 0;
    return {
      icon:
        sources.lead === "builder"
          ? BUILDER_ICON
          : brandIcon(
              sources.lead ? AGENT_PROVIDER_LOGOS[sources.lead] : null,
              "cpu",
            ),
      status: setUp ? undefined : tag(tags?.model ?? "required"),
      description: rowDescription(
        setUp ? formatters.formatList(sources.labels) : t(`${K}notSetUp`),
        t(`${K}useEveryApp`),
      ),
      control: setUp
        ? {
            button: t(`${K}manage`),
            segment: "manage",
            onClick: () => navigate("model"),
          }
        : {
            button: t(`${K}setUp`),
            segment: "set-up",
            onClick: () => navigate("model"),
          },
    };
  })();

  // Services › File uploads and storage
  const storageRow = ((): InfraRow => {
    if (!storage.data) return failedRow(storage.refetch);
    const source = storageSource(storage.data);
    const preset =
      source.kind === "bucket"
        ? fileStorageProviderPreset(source.provider)
        : null;
    const text =
      source.kind === "unknown"
        ? t("agentChat.settings.storage.unreadable")
        : source.kind === "bucket"
          ? t(`${K}storageBucket`, {
              provider:
                preset?.name ?? t("agentChat.settings.storage.providerOther"),
              bucket: source.bucket,
            })
          : source.kind === "builder"
            ? BUILDER_LABEL
            : t(`${K}notSetUp`);
    const description = storageProviderStatusUnknown
      ? t("agentChat.settings.storage.unreadable")
      : storageBuilderGrantMissing
        ? t(`${K}storageBuilderGrantMissing`)
        : storageBuilderStatusUnknown
          ? t(`${K}storageBuilderStatusUnknown`)
          : rowDescription(text, t(`${K}useUploads`));
    return {
      icon:
        source.kind === "builder"
          ? BUILDER_ICON
          : {
              kind: "symbol",
              key:
                source.kind === "bucket"
                  ? fileStorageProviderPreset(source.provider).symbol
                  : "box",
            },
      status: source.kind === "none" ? tag(tags?.storage) : undefined,
      description,
      control:
        storageBuilderStatusUnknown || storageProviderStatusUnknown
          ? {
              content: (
                <div className="flex flex-wrap gap-2">
                  <RowButton onClick={() => void storage.refetch()}>
                    {t(`${K}retry`)}
                  </RowButton>
                  <RowButton onClick={() => setStorageOpen(true)}>
                    {source.kind === "none" ? t(`${K}setUp`) : t(`${K}manage`)}
                  </RowButton>
                </div>
              ),
            }
          : source.kind === "none"
            ? {
                button: t(`${K}setUp`),
                segment: "set-up",
                onClick: () => setStorageOpen(true),
              }
            : {
                button: t(`${K}manage`),
                segment: "manage",
                onClick: () => setStorageOpen(true),
              },
    };
  })();

  const storageBuilderReconnectScope =
    flow.effective === "org" && flow.canConnect.org
      ? "org"
      : flow.effective === "personal" && flow.canConnect.personal
        ? "personal"
        : hasOrg && flow.canConnect.org
          ? "org"
          : flow.canConnect.personal
            ? "personal"
            : null;
  useEffect(() => {
    if (
      !storageBuilderReconnectPending ||
      !storage.data ||
      storageSource(storage.data).kind !== "builder"
    ) {
      return;
    }
    setStorageOpen(false);
    setStorageBuilderReconnectPending(false);
  }, [storage.data, storageBuilderReconnectPending]);

  const serviceRow = (id: WorkspaceProviderServiceId): InfraRow => {
    const entry = PROVIDER_SERVICES[id];
    if (!services.data) return failedRow(services.refetch);
    const status = services.data.services.find((item) => item.service === id);
    if (!status) return failedRow(services.refetch);
    const provider = status.effectiveProvider;
    return {
      icon: provider
        ? brandIcon(SERVICE_PROVIDER_LOGOS[provider], "cube")
        : { kind: "symbol", key: entry.symbol },
      status: provider ? undefined : tag(tags?.[id]),
      description: rowDescription(
        provider ? SERVICE_PROVIDER_LABELS[provider] : t(`${K}notSetUp`),
        t(entry.useKey),
      ),
      control: provider
        ? {
            button: t(`${K}manage`),
            segment: "manage",
            onClick: () => setServiceOpen(id),
          }
        : {
            button: t(`${K}setUp`),
            segment: "set-up",
            onClick: () => setServiceOpen(id),
          },
    };
  };

  // Services › Semantic search, under Embeddings, whose provider it uses.
  const semanticSearchRow = (): InfraRow => {
    if (!services.data) return failedRow(services.refetch);
    const setting = services.data.semanticSearch;
    const icon: RowIcon = { kind: "symbol", key: "search" };
    if (!setting) {
      return {
        icon,
        description: t(`${K}semanticSearchUnknown`),
        descriptionContent: (
          <span className="text-destructive">
            {t(`${K}semanticSearchUnknown`)}
          </span>
        ),
        control: {
          button: t(`${K}retry`),
          segment: "retry",
          onClick: () => void services.refetch(),
        },
      };
    }
    return {
      icon,
      description: t(
        setting.enabled ? `${K}semanticSearchOn` : `${K}semanticSearchOff`,
      ),
      control: {
        content: (
          <span className="flex items-center gap-2">
            {semanticSearchRetry === setting.enabled &&
            services.data.canManage &&
            !semanticSearchSaving ? (
              <RowButton
                onClick={() => void setSemanticSearch(setting.enabled)}
              >
                {t(`${K}retry`)}
              </RowButton>
            ) : null}
            <Switch
              checked={setting.enabled}
              disabled={!services.data.canManage || semanticSearchSaving}
              aria-label={t(`${K}semanticSearch`)}
              onCheckedChange={(checked) => void setSemanticSearch(checked)}
            />
          </span>
        ),
      },
    };
  };

  const openService: ServiceProviderServiceStatus | null =
    (serviceOpen &&
      services.data?.services.find((item) => item.service === serviceOpen)) ||
    null;
  const openServiceMeta = serviceOpen ? PROVIDER_SERVICES[serviceOpen] : null;
  const builderProvidedServiceRow = (
    id: string,
    entry: ServiceRowMeta & { rowId: string },
    builderOnly: boolean,
  ): ModelFragment =>
    infraRow(
      `settings.infrastructure.services.${rowIdSegment(id)}`,
      entry.rowId,
      t(entry.labelKey),
      {
        icon:
          builderOnly && builderConnected
            ? BUILDER_ICON
            : { kind: "symbol", key: entry.symbol },
        status:
          builderOnly && !builderConnected ? (
            <Badge variant="outline" data-builder-only="">
              {t(`${K}builderOnly`)}
            </Badge>
          ) : undefined,
        description: rowDescription(
          builderOnly && builderConnected
            ? BUILDER_LABEL
            : t(`${K}availableWithBuilder`),
          t(entry.whyKey),
        ),
        control: recommendBuilder
          ? {
              content: connectBuilder(
                "outline",
                t("agentChat.setup.connectBuilder"),
              ),
            }
          : undefined,
      },
    );

  const serviceRows = WORKSPACE_SERVICES.flatMap((service): ModelFragment[] => {
    const rowId = `settings.infrastructure.services.${rowIdSegment(service.id)}`;
    switch (service.kind) {
      case "model":
        return [infraRow(rowId, "ai-model", t(`${K}aiModel`), aiModelRow)];
      case "storage":
        return [
          infraRow(
            rowId,
            "uploads",
            t("agentChat.settingsShell.search.fileUploads"),
            storageRow,
          ),
        ];
      case "provider":
        if (!hasOrg) return [];
        return [
          infraRow(
            rowId,
            service.id,
            t(PROVIDER_SERVICES[service.id].labelKey),
            serviceRow(service.id),
          ),
          ...(service.id === "embeddings"
            ? [
                infraRow(
                  "settings.infrastructure.services.semantic-search",
                  "semantic-search",
                  t(`${K}semanticSearch`),
                  semanticSearchRow(),
                ),
              ]
            : []),
        ];
      case "builder-only":
        return [
          builderProvidedServiceRow(
            service.id,
            BUILDER_ONLY_SERVICES[service.id],
            true,
          ),
        ];
      case "builder-included":
        return [
          builderProvidedServiceRow(
            service.id,
            BUILDER_INCLUDED_SERVICES[service.id],
            false,
          ),
        ];
    }
  });

  const page = combineFragments([
    infraGroup(
      "settings.infrastructure.setup",
      "setup",
      recommendBuilder ? t(`${K}recommended`) : t(`${K}setup`),
      [
        infraRow(
          "settings.infrastructure.setup.builder",
          "builder",
          BUILDER_LABEL,
          {
            icon: BUILDER_ICON,
            description: builderDescription,
            control: builderControl,
            detail:
              flow.error && flow.errorKind !== "status-read" ? (
                <p role="alert" className="text-sm text-destructive">
                  {flow.error}
                </p>
              ) : undefined,
          },
        ),
      ],
    ),
    infraGroup(
      "settings.infrastructure.services",
      "services",
      t(`${K}services`),
      serviceRows,
    ),
    environmentGroup({
      infra,
      onView: setEnvironmentOpen,
      t,
      formatList: (value) => formatters.formatList(value),
    }),
  ]);

  return (
    <div className="flex flex-col gap-8" data-infrastructure-settings="">
      <ModelSurface
        model={{ id: "settings", rows: page.rows }}
        actions={page.actions}
        slots={page.slots}
      />

      <Dialog
        open={storageOpen}
        onOpenChange={(open) => {
          setStorageOpen(open);
          if (!open) setStorageBuilderReconnectPending(false);
        }}
      >
        {storageOpen ? (
          <DialogContent
            className="max-w-2xl"
            closeLabel={t(`${K}close`)}
            data-storage-dialog=""
          >
            <DialogHeader>
              <DialogTitle>{t(`${K}storageTitle`)}</DialogTitle>
              <DialogDescription>
                {t(
                  storageBuilderGrantMissing
                    ? `${K}storageBuilderGrantMissing`
                    : storageProviderStatusUnknown
                      ? "agentChat.settings.storage.unreadable"
                      : storageBuilderStatusUnknown
                        ? `${K}storageBuilderStatusUnknown`
                        : `${K}storageIntro`,
                )}
              </DialogDescription>
            </DialogHeader>
            {storageBuilderGrantMissing ? (
              <div className="flex flex-col gap-2">
                {storageBuilderReconnectScope ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    disabled={flow.connecting}
                    onClick={() => {
                      setStorageBuilderReconnectPending(true);
                      flow.start({
                        provisionAccount: false,
                        scope: storageBuilderReconnectScope,
                        trackingFlow: "file_upload",
                      });
                    }}
                  >
                    {flow.connecting ? <Spinner aria-hidden /> : null}
                    {flow.connecting
                      ? t(`${K}connecting`)
                      : t(`${K}reconnectBuilderUploads`)}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    onClick={() => navigate("integrations", "builder")}
                  >
                    {t(`${K}manage`)}
                  </Button>
                )}
                {flow.error && flow.errorKind !== "status-read" ? (
                  <p role="alert" className="text-sm text-destructive">
                    {flow.error}
                  </p>
                ) : null}
              </div>
            ) : null}
            {storageBuilderStatusUnknown || storageProviderStatusUnknown ? (
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => void storage.refetch()}
              >
                {t(`${K}retry`)}
              </Button>
            ) : null}
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

function environmentGroup({
  infra,
  onView,
  t,
  formatList,
}: {
  infra: QueryState<InfrastructureStatus>;
  onView: (id: EnvironmentDialogId) => void;
  t: Translate;
  formatList: (value: string[]) => string;
}): ModelFragment {
  const view = (id: EnvironmentDialogId): InfraRowControl => ({
    button: t(`${K}view`),
    segment: "view",
    onClick: () => onView(id),
  });
  const group = (rows: readonly ModelFragment[]) =>
    infraGroup(
      "settings.infrastructure.environment",
      "environment",
      t(`${K}environment`),
      rows,
    );
  const databaseLabel = t("agentChat.settingsShell.search.database");
  const hostingLabelText = t("agentChat.settingsShell.search.hosting");
  const variablesLabel = t(`${K}variables`);
  const status = infra.data;
  if (!status) {
    const failed = {
      description: t(`${K}loadFailed`),
      descriptionContent: (
        <span className="text-destructive">{t(`${K}loadFailed`)}</span>
      ),
    };
    return group([
      infraRow(
        "settings.infrastructure.environment.database",
        "database",
        databaseLabel,
        {
          ...failed,
          control: {
            button: t(`${K}retry`),
            segment: "retry",
            onClick: () => void infra.refetch(),
          },
        },
      ),
      infraRow(
        "settings.infrastructure.environment.hosting",
        "hosting",
        hostingLabelText,
        failed,
      ),
      infraRow(
        "settings.infrastructure.environment.variables",
        "variables",
        variablesLabel,
        failed,
      ),
    ]);
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

  return group([
    infraRow(
      "settings.infrastructure.environment.database",
      "database",
      databaseLabel,
      {
        icon: brandIcon(
          database.provider ? DATABASE_PROVIDER_LOGOS[database.provider] : null,
          "database",
        ),
        description: databaseDescription,
        control: view("database"),
      },
    ),
    infraRow(
      "settings.infrastructure.environment.hosting",
      "hosting",
      hostingLabelText,
      {
        icon: brandIcon(HOSTING_PLATFORM_LOGOS[hosting.platform], "server"),
        description: hostingDescription,
        control: view("hosting"),
      },
    ),
    infraRow(
      "settings.infrastructure.environment.variables",
      "variables",
      variablesLabel,
      {
        icon: { kind: "symbol", key: "key" },
        badge: missing.length ? t(`${K}required`) : undefined,
        description: variablesDescription,
        control: view("variables"),
      },
    ),
  ]);
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
