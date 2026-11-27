import type { ProviderKeyPolicyStatus } from "@agent-native/core/agent/actions/manage-provider-key-policy";
import { CHATGPT_SUBSCRIPTION_ENGINE_NAME } from "@agent-native/core/agent/chatgpt-subscription-contract";
import { upgradeModelForProvider } from "@agent-native/core/agent/model-version";
import {
  setAgentEngineDefaultModel,
  type AgentEngineKeyScope,
} from "@agent-native/core/client/agent-engine-key";
import {
  fetchAgentLoopSettings,
  saveAgentLoopMaxIterations,
  type AgentLoopSettingsStatus,
} from "@agent-native/core/client/agent-loop-settings";
import {
  getAgentProviderOption,
  type AgentProviderId,
} from "@agent-native/core/client/agent-provider-catalog";
import type { ChatModelEngineEntry } from "@agent-native/core/client/chat-model-groups";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useLabState } from "@agent-native/core/client/labs/use-lab";
import { useOrg } from "@agent-native/core/client/org";
import {
  type ModelRow,
  rowAttributes,
  rowIdSegment,
} from "@agent-native/design-system/model";
import { Button } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import { IconCpu, IconLock, IconPlus } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router";

import {
  combineFragments,
  type ModelFragment,
  ModelSurface,
} from "../../../design-system/parts.js";
import { ErrorRow, SettingsEmpty } from "../../resources/index.js";
import { DeferredBuilderConnectPopover } from "../deferred-builder-connect-popover.js";
import { useSettingsPageHeader, useSettingsShell } from "../shell/context.js";
import type { SettingsPageProps } from "../shell/registry.js";
import {
  useBuilderConnectFlow,
  type BuilderConnectFlow,
  type BuilderConnectionScope,
} from "../useBuilderStatus.js";
import { useChatGPTSubscriptionRow } from "./ChatGPTSubscriptionRow.js";
import {
  addableProviders,
  defaultModelGroups,
  defaultModelValue,
  keyDetailParts,
  parseDefaultModelValue,
  providerForEngine,
  providerRows,
  type ChatGPTModelCatalog,
  type ModelProvidersListing,
  type ProviderKeyRow,
  type ProviderModelsRead,
} from "./model-page-state.js";
import { ProviderDialog } from "./ProviderDialog.js";
import { RemoveProviderDialog } from "./RemoveProviderDialog.js";
import { RestrictKeysDialog } from "./RestrictKeysDialog.js";

const K = "agentChat.settingsModel.";
// The row labels settings search already uses for these rows.
const DEFAULT_MODEL_LABEL = "agentChat.settingsShell.search.defaultModel";
const MAX_ITERATIONS_LABEL = "agentChat.settingsShell.search.maxIterations";
const BUILDER_LABEL = "Builder.io";
const CHATGPT_LABEL = "ChatGPT";
const POLICY_QUERY_KEY = ["action", "manage-provider-key-policy", {}] as const;
const ENGINES_QUERY_KEY = ["action", "manage-agent-engine", { action: "list" }];
const LOOP_QUERY_KEY = [
  "action",
  "manage-agent-loop-settings",
  { action: "get" },
] as const;

type DialogState =
  | { mode: "add" }
  | { mode: "manage"; provider: AgentProviderId; scope: AgentEngineKeyScope };

type DialogFragment = ModelFragment & { dialog: ReactNode };

type ActiveDialogState = {
  dialog: DialogState;
  trackingFlow: "chat_setup" | "settings";
};

type ChatGPTSubscriptionStatusRead = {
  connected: boolean;
  activeAccountId: string | null;
};

/** `get-provider-models`, kept apart so a failed read never reads as "no models". */
type ModelsReadState =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "ready"; data: ProviderModelsRead };

/** The signed-in ChatGPT account's model list for the personal default. */
type ChatGPTModelsState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "ready"; catalog: ChatGPTModelCatalog };

function useChatGPTModels(
  personalDefault: boolean,
  connected: boolean,
  accountId: string | null,
  statusError: boolean,
  retryStatus: () => void,
): ChatGPTModelsState {
  const query = useQuery({
    queryKey: [...ENGINES_QUERY_KEY, accountId],
    enabled: personalDefault && connected && accountId !== null && !statusError,
    queryFn: () =>
      callAction<{ engines?: ChatModelEngineEntry[] }>(
        "manage-agent-engine" as never,
        { action: "list" } as never,
      ),
    select: (result): ChatGPTModelCatalog => {
      const entry = result.engines?.find(
        (engine) => engine.name === CHATGPT_SUBSCRIPTION_ENGINE_NAME,
      );
      // A catalog the server couldn't read is an error, not an empty list.
      if (!entry || entry.configuredError) {
        throw new Error(entry?.configuredError ?? "No ChatGPT model list.");
      }
      return {
        label: CHATGPT_LABEL,
        models: [...(entry.supportedModels ?? [])],
        displayNames: { ...entry.modelDisplayNames },
      };
    },
  });
  if (!personalDefault) return { status: "off" };
  if (statusError) return { status: "error", retry: retryStatus };
  if (!connected) return { status: "off" };
  if (!accountId) return { status: "loading" };
  if (query.data) return { status: "ready", catalog: query.data };
  if (query.isError) {
    return { status: "error", retry: () => void query.refetch() };
  }
  return { status: "loading" };
}

/**
 * Settings › Agent › Model: Organization providers, Personal providers, and
 * Organization settings (spec §5.6). Every control writes through an action
 * or its named client helper; the page only arranges what they return.
 */
export default function ModelSettingsPage(_props: SettingsPageProps) {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const chatSetupTrackingPending = useRef(
    (location.state as { providerSetupTrackingFlow?: unknown } | null)
      ?.providerSetupTrackingFlow === "chat_setup",
  );
  const org = useOrg();
  const listing = useActionQuery<ModelProvidersListing>(
    "list-model-providers" as never,
  );
  const models = useActionQuery<ProviderModelsRead>(
    "get-provider-models" as never,
  );
  const builder = useBuilderConnectFlow({
    provisionAccount: true,
    trackingSource: "settings_model",
    trackingFlow: "connect_llm",
  });
  const [dialog, setDialog] = useState<ActiveDialogState | null>(null);
  const [removing, setRemoving] = useState<ProviderKeyRow | null>(null);
  const openProviderDialog = useCallback(
    (nextDialog: DialogState) => {
      const trackingFlow = chatSetupTrackingPending.current
        ? "chat_setup"
        : "settings";
      if (chatSetupTrackingPending.current) {
        chatSetupTrackingPending.current = false;
        const locationState =
          location.state && typeof location.state === "object"
            ? Object.fromEntries(
                Object.entries(location.state).filter(
                  ([key]) => key !== "providerSetupTrackingFlow",
                ),
              )
            : null;
        navigate(
          {
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
          },
          {
            replace: true,
            state:
              locationState && Object.keys(locationState).length > 0
                ? locationState
                : null,
          },
        );
      }
      setDialog({ dialog: nextDialog, trackingFlow });
    },
    [location.hash, location.pathname, location.search, navigate],
  );

  const chatgptLab = useLabState("chatgpt-subscription");
  const chatgptStatus = useActionQuery<ChatGPTSubscriptionStatusRead>(
    "get-chatgpt-subscription-status" as never,
    undefined,
    { enabled: chatgptLab.enabled },
  );
  // A failed read leaves status unknown, even when React Query has old data.
  const chatgptConnected = !chatgptLab.enabled
    ? false
    : chatgptStatus.isError
      ? null
      : (chatgptStatus.data?.connected ?? null);
  const chatgptAccountId =
    !chatgptLab.enabled || chatgptStatus.isError
      ? null
      : (chatgptStatus.data?.activeAccountId ?? null);
  const chatgptModels = useChatGPTModels(
    listing.data?.hasOrganization === false,
    chatgptLab.enabled && chatgptConnected === true,
    chatgptAccountId,
    chatgptLab.enabled && chatgptStatus.isError,
    () => void chatgptStatus.refetch(),
  );

  const canAdd = listing.data
    ? addableProviders(listing.data).length > 0
    : false;
  const needsProvider = listing.data
    ? !hasAnyProvider(
        listing.data,
        providerRows(listing.data, models.data),
        builder,
        chatgptConnected,
      )
    : false;
  // The empty state carries the page's actions, so the header stays empty
  // while it shows: one primary on screen.
  const header = useMemo(
    () => ({
      action:
        canAdd && !needsProvider ? (
          <AddProviderButton
            onClick={() => openProviderDialog({ mode: "add" })}
          />
        ) : undefined,
    }),
    [canAdd, needsProvider, openProviderDialog],
  );
  useSettingsPageHeader(header);

  if (listing.isError) {
    return (
      <ModelSurface
        model={{
          id: "settings",
          rows: [
            {
              id: "settings.model.load-error",
              part: "settings.group",
              label: t("agentChat.settingsShell.page.model"),
              labelHidden: true,
              slot: "load-error",
            },
          ],
        }}
        slots={{
          "load-error": (
            <ErrorRow
              text={t(`${K}loadFailed`)}
              onRetry={() => void listing.refetch()}
            />
          ),
        }}
      />
    );
  }
  if (!listing.data || org.isLoading) return <ModelPageSkeleton />;

  const data = listing.data;
  const rows = providerRows(data, models.data);
  const modelsRead: ModelsReadState = models.data
    ? { status: "ready", data: models.data }
    : models.isError
      ? { status: "error", retry: () => void models.refetch() }
      : { status: "loading" };
  const orgName = org.data?.orgName ?? "";
  const openManage = (row: ProviderKeyRow) =>
    openProviderDialog({
      mode: "manage",
      provider: row.provider,
      scope: row.key.scope,
    });

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-8" data-model-settings="">
        {needsProvider ? (
          <ModelSurface
            model={{
              id: "settings",
              rows: [
                {
                  id: "settings.model.no-provider",
                  part: "settings.group",
                  label: t("agentChat.settingsShell.page.model"),
                  labelHidden: true,
                  anchor: "llm",
                  slot: "no-provider",
                },
              ],
            }}
            slots={{
              "no-provider": (
                <NoProviderEmpty
                  listing={data}
                  canAdd={canAdd}
                  builder={builder}
                  onAdd={() => openProviderDialog({ mode: "add" })}
                />
              ),
            }}
          />
        ) : data.hasOrganization ? (
          <OrgProvidersGroup
            listing={data}
            rows={rows.org}
            builder={builder}
            orgName={orgName}
            modelsLoading={modelsRead.status === "loading"}
            onManage={openManage}
            onRemove={setRemoving}
          />
        ) : null}
        <PersonalProvidersGroup
          listing={data}
          rows={rows.personal}
          builder={builder}
          orgName={orgName}
          hideBuilder={needsProvider}
          modelsLoading={modelsRead.status === "loading"}
          onManage={openManage}
          onRemove={setRemoving}
        />
        <OrganizationSettingsGroup
          listing={data}
          models={modelsRead}
          chatgpt={chatgptModels}
          builder={builder}
          hasProvider={!needsProvider}
          onAddProvider={
            canAdd ? () => openProviderDialog({ mode: "add" }) : undefined
          }
        />
      </div>
      <ProviderDialog
        open={dialog !== null}
        trackingFlow={dialog?.trackingFlow ?? "settings"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        mode={dialog?.dialog.mode ?? "add"}
        {...(dialog?.dialog.mode === "manage"
          ? {
              provider: dialog.dialog.provider,
              scope: dialog.dialog.scope,
            }
          : {})}
      />
      {removing ? (
        <RemoveProviderDialog
          open
          onOpenChange={(open) => {
            if (!open) setRemoving(null);
          }}
          provider={removing.provider}
          scope={removing.key.scope}
        />
      ) : null}
    </TooltipProvider>
  );
}

/** The page's one action, and the empty state's when Builder.io isn't offered. */
function AddProviderButton({
  variant = "default",
  onClick,
}: {
  variant?: "default" | "outline";
  onClick: () => void;
}) {
  const t = useT();
  return (
    <Button type="button" variant={variant} size="sm" onClick={onClick}>
      <IconPlus />
      {t(`${K}addProvider`)}
    </Button>
  );
}

/**
 * Whether the agent has a provider to answer with: a connected ChatGPT plan
 * (the viewer's own, and not an API key, so personal key restrictions don't
 * apply), a connected Builder.io or an organization key, or for members (while
 * personal API keys aren't restricted) and people without an organization, one
 * of their own. Unknown Builder.io or ChatGPT status (`null`) counts as a
 * provider, so the empty state never flashes before the status read answers.
 */
function hasAnyProvider(
  listing: ModelProvidersListing,
  rows: { org: ProviderKeyRow[]; personal: ProviderKeyRow[] },
  builder: BuilderConnectFlow,
  chatgptConnected: boolean | null,
): boolean {
  if (listing.providers.some((provider) => provider.deploymentConfigured)) {
    return true;
  }
  if (chatgptConnected !== false || !builder.hasFetchedStatus) return true;
  if (!listing.hasOrganization) {
    return builder.configured || rows.personal.length > 0;
  }
  if (builder.grants === null) return true;
  const connected = (grant: { needsReconnect?: boolean } | null | undefined) =>
    !!grant && !grant.needsReconnect;
  if (connected(builder.grants.org) || rows.org.length > 0) return true;
  // Restricted personal keys and connections stay listed but aren't used.
  if (listing.canManageOrg || listing.personalKeysRestricted) return false;
  return connected(builder.grants.personal) || rows.personal.length > 0;
}

/**
 * No provider yet: why the agent needs one, and the ways to add it. Builder.io
 * is the recommended path, so it is the primary action whenever the viewer may
 * connect it, and adding a provider key is the secondary one.
 */
function NoProviderEmpty({
  listing,
  canAdd,
  builder,
  onAdd,
}: {
  listing: ModelProvidersListing;
  canAdd: boolean;
  builder: BuilderConnectFlow;
  onAdd: () => void;
}) {
  const t = useT();
  const scope: BuilderConnectionScope = listing.canManageOrg
    ? "org"
    : "personal";
  const canConnect =
    !listing.hasOrganization ||
    (builder.canConnect[scope] &&
      (scope === "org" || !listing.personalKeysRestricted));
  const connect = canConnect ? (
    <DeferredBuilderConnectPopover
      flow={builder}
      onConnect={(provisionAccount) =>
        builder.start({
          provisionAccount,
          ...(listing.hasOrganization ? { scope } : {}),
        })
      }
    >
      <Button type="button" size="sm" disabled={builder.connecting}>
        {builder.connecting ? <Spinner /> : null}
        {builder.connecting
          ? t("agentChat.composer.connectingBuilder")
          : t("agentChat.setup.connectBuilder")}
      </Button>
    </DeferredBuilderConnectPopover>
  ) : null;
  return (
    <>
      <SettingsEmpty
        icon={IconCpu}
        title={t(`${K}emptyTitle`)}
        description={
          canConnect
            ? t(`${K}emptyDescriptionBuilder`)
            : canAdd
              ? t(`${K}emptyDescription`)
              : t(`${K}emptyAskAdmin`)
        }
      >
        {canAdd || connect ? (
          <>
            {connect}
            {canAdd ? (
              <AddProviderButton
                variant={connect ? "outline" : "default"}
                onClick={onAdd}
              />
            ) : null}
          </>
        ) : null}
      </SettingsEmpty>
      {builder.error ? (
        <p role="alert" className="px-5 pb-4 text-sm text-destructive sm:px-6">
          {builder.error}
        </p>
      ) : null}
    </>
  );
}

function PersonalProvidersGroup({
  listing,
  rows,
  builder,
  orgName,
  hideBuilder,
  modelsLoading,
  onManage,
  onRemove,
}: {
  listing: ModelProvidersListing;
  rows: ProviderKeyRow[];
  builder: BuilderConnectFlow;
  orgName: string;
  /** The no-provider empty state offers Builder.io instead. */
  hideBuilder: boolean;
  modelsLoading: boolean;
  onManage: (row: ProviderKeyRow) => void;
  onRemove: (row: ProviderKeyRow) => void;
}) {
  const t = useT();
  const restricted = listing.personalKeysRestricted;
  const personalGrant = builder.grants?.personal;
  // Owners and admins connect Builder.io for the organization (open question
  // 8.1.1), so only members, and people without one, get a personal row.
  const showBuilder =
    !hideBuilder &&
    (listing.hasOrganization
      ? !listing.canManageOrg && (!!personalGrant || !restricted)
      : true);
  const hasProviderRows = showBuilder || rows.length > 0;
  const formatters = useFormatters();
  const builderRow = useBuilderRow({
    scope: "personal",
    flow: builder,
    canManage: true,
    orgName,
    hasOrganization: listing.hasOrganization,
    restricted,
  });
  const chatgpt = useChatGPTSubscriptionRow(
    "settings.model.personal-providers.chatgpt",
  );
  const restrictedEmpty: ModelFragment = {
    rows: [
      {
        id: "settings.model.personal-providers.restricted",
        part: "settings.content",
        label: t(`${K}restricted`),
        slot: "personal-providers-restricted",
      },
    ],
    slots: {
      "personal-providers-restricted": (row: ModelRow) => (
        <SettingsEmpty
          {...rowAttributes(row)}
          icon={IconLock}
          title={t(`${K}restricted`)}
        />
      ),
    },
  };
  const group = combineFragments([
    ...(showBuilder ? [builderRow] : []),
    ...rows.map((row) =>
      keyProviderRow(row, {
        t,
        formatters,
        canManage: true,
        modelsLoading,
        onManage: () => onManage(row),
        onRemove: () => onRemove(row),
      }),
    ),
    chatgpt,
    ...(!hasProviderRows && restricted ? [restrictedEmpty] : []),
  ]);
  return (
    <div>
      <ModelSurface
        model={{
          id: "settings",
          rows: [
            {
              id: "settings.model.personal-providers",
              part: "settings.group",
              label: t(`${K}personalProviders`),
              anchor:
                listing.hasOrganization || hideBuilder
                  ? "personal-providers"
                  : "llm",
              rows: group.rows,
            },
          ],
        }}
        actions={group.actions}
        slots={group.slots}
      />
      {chatgpt.dialog}
      {restricted && hasProviderRows ? (
        <p className="mt-2 px-1 text-xs leading-5 text-muted-foreground">
          {t(`${K}restricted`)}
        </p>
      ) : null}
    </div>
  );
}

function OrgProvidersGroup({
  listing,
  rows,
  builder,
  orgName,
  modelsLoading,
  onManage,
  onRemove,
}: {
  listing: ModelProvidersListing;
  rows: ProviderKeyRow[];
  builder: BuilderConnectFlow;
  orgName: string;
  modelsLoading: boolean;
  onManage: (row: ProviderKeyRow) => void;
  onRemove: (row: ProviderKeyRow) => void;
}) {
  const t = useT();
  const formatters = useFormatters();
  const builderRow = useBuilderRow({
    scope: "org",
    flow: builder,
    canManage: listing.canManageOrg,
    orgName,
  });
  const group = combineFragments([
    builderRow,
    ...rows.map((row) =>
      keyProviderRow(row, {
        t,
        formatters,
        canManage: listing.canManageOrg,
        modelsLoading,
        onManage: () => onManage(row),
        onRemove: () => onRemove(row),
      }),
    ),
  ]);
  return (
    <ModelSurface
      model={{
        id: "settings",
        rows: [
          {
            id: "settings.model.org-providers",
            part: "settings.group",
            label: t(`${K}orgProviders`),
            anchor: "llm",
            rows: group.rows,
          },
        ],
      }}
      actions={group.actions}
      slots={group.slots}
    />
  );
}

function useBuilderRow({
  scope,
  flow,
  canManage,
  orgName,
  hasOrganization = true,
  restricted = false,
}: {
  scope: BuilderConnectionScope;
  flow: BuilderConnectFlow;
  canManage: boolean;
  orgName: string;
  hasOrganization?: boolean;
  restricted?: boolean;
}): ModelFragment {
  const t = useT();
  const { navigate } = useSettingsShell();
  const grant = hasOrganization
    ? flow.grants?.[scope]
    : (flow.grants?.personal ?? flow.grants?.org);
  const connected = hasOrganization
    ? !!grant && !grant.needsReconnect
    : flow.configured;
  const orgConnected = !!flow.grants?.org && !flow.grants.org.needsReconnect;
  const space =
    flow.orgName &&
    (!hasOrganization ||
      flow.effective === (scope === "org" ? "org" : "personal"))
      ? flow.orgName
      : null;

  let description: string | undefined;
  if (!flow.hasFetchedStatus) {
    description = undefined;
  } else if (flow.grants === null && hasOrganization) {
    description = t(`${K}builderUnknown`);
  } else if (scope === "org") {
    description = connected
      ? space
        ? t(`${K}builderConnected`, { space })
        : t(`${K}builderConnectedPlain`)
      : canManage
        ? t(`${K}builderOrgNotConnectedAdmin`, { org: orgName })
        : t(`${K}builderOrgNotConnectedMember`);
  } else if (connected && restricted) {
    description = t(`${K}restrictedRow`);
  } else if (connected) {
    description =
      hasOrganization && orgConnected
        ? space
          ? t(`${K}builderPersonalOverOrg`, { space })
          : t(`${K}builderPersonalOverOrgPlain`)
        : space
          ? t(`${K}builderConnected`, { space })
          : t(`${K}builderConnectedPlain`);
  } else {
    description = orgConnected
      ? t(`${K}builderPersonalInsteadOfOrg`)
      : t(`${K}builderPersonalConnect`);
  }

  const id = `settings.model.${scope}-providers.builder`;
  const openPage = () => navigate("integrations", "builder");
  const mayConnect = hasOrganization ? flow.canConnect[scope] : true;
  let control: ReactNode = null;
  let manage: ModelRow | null = null;
  let recommended = false;
  if (flow.hasFetchedStatus) {
    if (connected || (flow.grants === null && hasOrganization)) {
      manage = {
        id: `${id}.open`,
        part: "button",
        kind: "action",
        label: canManage ? t(`${K}manage`) : t(`${K}view`),
        effect: { kind: "action", effectId: `${scope}-builder-open` },
      };
    } else if (mayConnect) {
      // A member connecting their own account over a working organization
      // connection is an override, not the recommended path.
      recommended = !orgConnected;
      control = (
        <DeferredBuilderConnectPopover
          flow={flow}
          onConnect={(provisionAccount) =>
            flow.start({
              provisionAccount,
              ...(hasOrganization ? { scope } : {}),
            })
          }
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={flow.connecting}
          >
            {flow.connecting ? <Spinner /> : null}
            {flow.connecting
              ? t("agentChat.composer.connectingBuilder")
              : t("agentChat.setup.connectBuilder")}
          </Button>
        </DeferredBuilderConnectPopover>
      );
    }
  }

  const regions: Record<string, string> = {};
  if (!flow.hasFetchedStatus) regions.description = `${scope}-builder-loading`;
  if (flow.error) regions.detail = `${scope}-builder-error`;
  return {
    rows: [
      {
        id,
        part: "settings.row",
        label: BUILDER_LABEL,
        description,
        anchor: `provider-${scope}-builder`,
        state: recommended
          ? {
              badge: {
                kind: "label",
                value: t("agentChat.integrations.recommended"),
              },
            }
          : undefined,
        slot: control ? `${scope}-builder-connect` : undefined,
        regions,
        rows: manage ? [manage] : undefined,
      },
    ],
    actions: { [`${scope}-builder-open`]: openPage },
    slots: {
      [`${scope}-builder-connect`]: control,
      [`${scope}-builder-loading`]: (
        <span
          aria-hidden
          className="skeleton-shimmer inline-block h-4 w-56 rounded-md bg-muted align-middle"
        />
      ),
      [`${scope}-builder-error`]: (
        <p role="alert" className="text-sm text-destructive">
          {flow.error}
        </p>
      ),
    },
  };
}

function keyProviderRow(
  row: ProviderKeyRow,
  {
    t,
    formatters,
    canManage,
    modelsLoading,
    onManage,
    onRemove,
  }: {
    t: ReturnType<typeof useT>;
    formatters: ReturnType<typeof useFormatters>;
    canManage: boolean;
    modelsLoading: boolean;
    onManage: () => void;
    onRemove: () => void;
  },
): ModelFragment {
  const { key } = row;
  const scope = key.scope === "org" ? "org" : "personal";
  const id = `settings.model.${scope}-providers.${rowIdSegment(row.provider)}`;
  const effectId = `${scope}-${row.provider}`;

  let description: ReactNode;
  let control: ReactNode = null;
  let action: string | null = null;
  if (key.unreadable) {
    description = t(`${K}unreadable`);
    if (canManage) {
      action = t(
        key.unreadableEndpoint && !key.unreadableKey
          ? `${K}replaceEndpoint`
          : `${K}replaceKey`,
      );
    } else {
      description = t(`${K}unreadableAskAdmin`);
    }
  } else if (key.rejectedAt) {
    const date = formatters.formatDate(key.rejectedAt, {
      month: "short",
      day: "numeric",
    });
    description = (
      <span className="text-destructive">
        {canManage
          ? t(`${K}rejected`, { provider: row.label, date })
          : t(`${K}rejectedAskAdmin`, { provider: row.label, date })}
      </span>
    );
    if (canManage) action = t(`${K}replaceKey`);
  } else if (row.restricted) {
    description = t(`${K}restrictedRow`);
    control = (
      <RowButton destructive onClick={onRemove}>
        {t(`${K}remove`)}
      </RowButton>
    );
  } else {
    const count =
      row.modelCount === null
        ? null
        : row.modelCount === 0
          ? t(`${K}noChatModels`)
          : t(`${K}modelCount`, { count: row.modelCount });
    const text = [...keyDetailParts(key), ...(count ? [count] : [])].join(
      " · ",
    );
    description =
      count === null && modelsLoading ? (
        // The description renders in a <p>, so the count's placeholder is inline.
        <>
          {text ? `${text} · ` : null}
          <span
            aria-hidden
            data-model-count-loading=""
            className="skeleton-shimmer inline-block h-4 w-16 rounded-md bg-muted align-middle"
          />
        </>
      ) : (
        text
      );
    if (canManage) action = t(`${K}manage`);
  }

  const text = typeof description === "string" ? description : undefined;
  return {
    rows: [
      {
        id,
        part: "settings.row",
        label: row.label,
        description: text || undefined,
        anchor: `provider-${scope}-${row.provider}`,
        slot: control ? `${effectId}-control` : undefined,
        regions:
          description && text === undefined
            ? { description: `${effectId}-description` }
            : undefined,
        rows: action
          ? [
              {
                id: `${id}.manage`,
                part: "button",
                kind: "action",
                label: action,
                effect: { kind: "action", effectId: `${effectId}-manage` },
              },
            ]
          : undefined,
      },
    ],
    actions: { [`${effectId}-manage`]: onManage },
    slots: {
      [`${effectId}-control`]: control,
      [`${effectId}-description`]: description,
    },
  };
}

function OrganizationSettingsGroup({
  listing,
  models,
  chatgpt,
  builder,
  hasProvider,
  onAddProvider,
}: {
  listing: ModelProvidersListing;
  models: ModelsReadState;
  chatgpt: ChatGPTModelsState;
  builder: BuilderConnectFlow;
  hasProvider: boolean;
  onAddProvider?: (() => void) | undefined;
}) {
  const t = useT();
  const hasOrg = listing.hasOrganization;
  const defaultModel = useDefaultModelRow({
    listing,
    models,
    chatgpt,
    builder,
    hasProvider,
    onAddProvider,
  });
  const restrictKeys = useRestrictKeysRow(hasOrg && listing.canManageOrg);
  const maxIterations = useMaxIterationsRow();
  const group = combineFragments([defaultModel, restrictKeys, maxIterations]);
  return (
    <>
      <ModelSurface
        model={{
          id: "settings",
          rows: [
            {
              id: "settings.model.settings",
              part: "settings.group",
              label: hasOrg
                ? t(`${K}orgSettings`)
                : t("agentChat.settingsShell.page.model"),
              labelHidden: !hasOrg,
              anchor: "limits",
              rows: group.rows,
            },
          ],
        }}
        actions={group.actions}
        slots={group.slots}
      />
      {restrictKeys.dialog}
    </>
  );
}

function useDefaultModelRow({
  listing,
  models: modelsRead,
  chatgpt,
  builder,
  hasProvider,
  onAddProvider,
}: {
  listing: ModelProvidersListing;
  models: ModelsReadState;
  chatgpt: ChatGPTModelsState;
  builder: BuilderConnectFlow;
  hasProvider: boolean;
  onAddProvider?: (() => void) | undefined;
}): ModelFragment {
  const t = useT();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<{
    engine: string;
    model: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const models = modelsRead.status === "ready" ? modelsRead.data : undefined;
  const builderConnected = listing.hasOrganization
    ? !!builder.grants?.org && !builder.grants.org.needsReconnect
    : builder.configured;
  const groups = defaultModelGroups({
    listing,
    models,
    builderConnected,
    builderLabel: BUILDER_LABEL,
    chatgpt: chatgpt.status === "ready" ? chatgpt.catalog : undefined,
  });
  const stored = listing.defaultModel
    ? (() => {
        const group = groups.find(
          (candidate) => candidate.engine === listing.defaultModel?.engine,
        );
        const supportedModels = group?.models ?? [];
        const preserveCustomModels = group?.preserveCustomModels;
        const model = listing.defaultModel.model ?? supportedModels[0] ?? "";
        return {
          engine: listing.defaultModel.engine,
          model:
            (!preserveCustomModels &&
              upgradeModelForProvider(
                model,
                supportedModels,
                listing.defaultModel.engine,
              )) ||
            model,
        };
      })()
    : null;
  const storedGroup = stored
    ? groups.find((group) => group.engine === stored.engine)
    : undefined;
  const current = pending ?? (storedGroup ? stored : null);
  const engineLabel = (engine: string) => {
    const provider = providerForEngine(engine);
    if (provider === "builder") return BUILDER_LABEL;
    if (provider) return getAgentProviderOption(provider).label;
    return engine === "chatgpt-subscription" ? CHATGPT_LABEL : engine;
  };
  const currentLabel = current
    ? current.model
      ? t(`${K}modelOption`, {
          model: current.model,
          provider: engineLabel(current.engine),
        })
      : engineLabel(current.engine)
    : t(`${K}notSet`);
  // Keep a stored model visible if its provider is available but the model is
  // no longer in that provider's checked list.
  const offered =
    current &&
    groups.some(
      (group) =>
        group.engine === current.engine && group.models.includes(current.model),
    );
  const allGroups =
    current && current.model && !offered
      ? [
          {
            engine: current.engine,
            provider: providerForEngine(current.engine) ?? "builder",
            label: engineLabel(current.engine),
            models: [current.model],
          },
          ...groups,
        ]
      : groups;

  const choose = async (value: string) => {
    const next = parseDefaultModelValue(value);
    if (!next) return;
    setError(null);
    setPending(next);
    try {
      await setAgentEngineDefaultModel({
        engine: next.engine,
        model: next.model,
        label: engineLabel(next.engine),
      });
      await queryClient.invalidateQueries({ queryKey: ["action"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  };

  // Until a provider is added there is nothing to choose; the row says so.
  const waitingForProvider = !hasProvider;
  const retryRead =
    modelsRead.status === "error"
      ? modelsRead.retry
      : chatgpt.status === "error"
        ? chatgpt.retry
        : null;

  const control: ReactNode =
    modelsRead.status === "loading" || chatgpt.status === "loading" ? (
      <Skeleton className="h-8 w-64 max-w-full" data-default-model-loading="" />
    ) : modelsRead.status === "error" ? null : waitingForProvider &&
      onAddProvider ? (
      <AddProviderButton variant="outline" onClick={onAddProvider} />
    ) : waitingForProvider ||
      (listing.canUpdateDefault && allGroups.length === 0) ? (
      <Select disabled>
        <SelectTrigger
          size="sm"
          className="w-64 max-w-full"
          aria-label={t(DEFAULT_MODEL_LABEL)}
        >
          <SelectValue
            placeholder={
              current
                ? currentLabel
                : waitingForProvider
                  ? ""
                  : t(`${K}chooseModel`)
            }
          />
        </SelectTrigger>
      </Select>
    ) : listing.canUpdateDefault ? (
      <Select
        {...(current?.model
          ? { value: defaultModelValue(current.engine, current.model) }
          : {})}
        onValueChange={(value) => void choose(value)}
      >
        <SelectTrigger
          size="sm"
          className="w-64 max-w-full"
          aria-label={t(DEFAULT_MODEL_LABEL)}
        >
          <SelectValue placeholder={t(`${K}chooseModel`)} />
        </SelectTrigger>
        <SelectContent>
          {allGroups.map((group) => (
            <SelectGroup key={group.engine}>
              <SelectLabel>{group.label}</SelectLabel>
              {group.models.map((model) => (
                <SelectItem
                  key={model}
                  value={defaultModelValue(group.engine, model)}
                >
                  {t(`${K}modelOption`, {
                    model: group.modelDisplayNames?.[model] ?? model,
                    provider: group.label,
                  })}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    ) : (
      <ReadOnlyValue value={currentLabel} tip={t(`${K}lockedTip`)} />
    );

  return {
    rows: [
      {
        id: "settings.model.settings.default-model",
        part: "settings.row",
        label: t(DEFAULT_MODEL_LABEL),
        description: waitingForProvider
          ? t(`${K}defaultModelNeedsProvider`)
          : t(`${K}defaultModelDescription`),
        anchor: "default-model",
        state: { value: currentLabel },
        slot: control ? "default-model-control" : undefined,
        regions: { detail: "default-model-detail" },
      },
    ],
    slots: {
      "default-model-control": control,
      "default-model-detail": (
        <>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {retryRead ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 text-sm"
            >
              <p className="text-destructive">{t(`${K}settingLoadFailed`)}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={retryRead}
              >
                {t("agentChat.common.retry")}
              </Button>
            </div>
          ) : null}
        </>
      ),
    },
  };
}

function useRestrictKeysRow(shown: boolean): DialogFragment {
  const t = useT();
  const queryClient = useQueryClient();
  const policy = useQuery({
    enabled: shown,
    queryKey: POLICY_QUERY_KEY,
    queryFn: () =>
      callAction<ProviderKeyPolicyStatus>(
        "manage-provider-key-policy" as never,
        {} as never,
        { method: "POST" },
      ),
  });
  const [pending, setPending] = useState<boolean | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Throws the server's message when the change is refused. */
  const write = async (restricted: boolean) => {
    setPending(restricted);
    try {
      const next = await callAction<ProviderKeyPolicyStatus>(
        "manage-provider-key-policy" as never,
        { set: restricted } as never,
        { method: "POST" },
      );
      queryClient.setQueryData(POLICY_QUERY_KEY, next);
      await queryClient.invalidateQueries({ queryKey: ["action"] });
    } finally {
      setPending(null);
    }
  };
  const unrestrict = async () => {
    setError(null);
    try {
      await write(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const checked = pending ?? policy.data?.restricted ?? false;
  const dialog = shown ? (
    <RestrictKeysDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      affectedMembers={policy.data?.affectedMembers}
      onConfirm={() => write(true)}
    />
  ) : null;
  if (!shown) return { rows: [], dialog };
  return {
    rows: [
      {
        id: "settings.model.settings.restrict-personal-keys",
        part: "settings.row",
        kind: policy.data ? "toggle" : undefined,
        label: t(`${K}restrictLabel`),
        description: t(`${K}restrictDescription`),
        anchor: "restrict-personal-keys",
        state: policy.data
          ? { checked, disabled: pending !== null }
          : undefined,
        effect: policy.data
          ? { kind: "action", effectId: "toggle-restrict-personal-keys" }
          : undefined,
        slot: policy.data || policy.isError ? undefined : "restrict-loading",
        regions:
          error || policy.isError
            ? { detail: "restrict-personal-keys-error" }
            : undefined,
      },
    ],
    actions: {
      "toggle-restrict-personal-keys": () => {
        setError(null);
        if (!checked) setConfirmOpen(true);
        else void unrestrict();
      },
    },
    slots: {
      "restrict-loading": <Skeleton className="h-4.5 w-8 rounded-full" />,
      "restrict-personal-keys-error": (
        <p role="alert" className="text-sm text-destructive">
          {error ?? t(`${K}settingLoadFailed`)}
        </p>
      ),
    },
    dialog,
  };
}

function useMaxIterationsRow(): ModelFragment {
  const t = useT();
  const queryClient = useQueryClient();
  const loop = useQuery({
    queryKey: LOOP_QUERY_KEY,
    queryFn: fetchAgentLoopSettings,
  });
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const errorId = useId();
  const settings = loop.data;

  useEffect(() => {
    if (!saving) setDraft(null);
  }, [settings?.maxIterations, saving]);

  const commit = async () => {
    if (!settings || draft === null) return;
    const value = Number(draft.trim());
    const min = settings.minMaxIterations;
    const max = settings.maxMaxIterations;
    if (!Number.isInteger(value) || value < min || value > max) {
      setError(t(`${K}maxIterationsInvalid`, { min, max }));
      return;
    }
    setError(null);
    if (value === settings.maxIterations) {
      setDraft(null);
      return;
    }
    setSaving(true);
    const previous = settings;
    queryClient.setQueryData<AgentLoopSettingsStatus>(LOOP_QUERY_KEY, {
      ...settings,
      maxIterations: value,
    });
    try {
      const saved = await saveAgentLoopMaxIterations(value);
      queryClient.setQueryData(LOOP_QUERY_KEY, saved);
    } catch (err) {
      queryClient.setQueryData(LOOP_QUERY_KEY, previous);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
      setDraft(null);
    }
  };

  const label = t(MAX_ITERATIONS_LABEL);
  let control: ReactNode;
  if (!settings) {
    control = loop.isError ? null : <Skeleton className="h-8 w-24" />;
  } else if (settings.canUpdate) {
    control = (
      <Input
        size="sm"
        type="number"
        inputMode="numeric"
        min={settings.minMaxIterations}
        max={settings.maxMaxIterations}
        step={1}
        className="w-24"
        aria-label={label}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        value={draft ?? String(settings.maxIterations)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          }
          if (event.key === "Escape") {
            setDraft(null);
            setError(null);
          }
        }}
      />
    );
  } else {
    control = (
      <ReadOnlyValue
        value={String(settings.maxIterations)}
        tip={t(`${K}lockedTip`)}
      />
    );
  }

  return {
    rows: [
      {
        id: "settings.model.settings.max-iterations",
        part: "settings.row",
        label,
        description: t(`${K}maxIterationsDescription`),
        anchor: "max-iterations",
        state: settings ? { value: String(settings.maxIterations) } : undefined,
        slot: control ? "max-iterations-control" : undefined,
        regions:
          error || loop.isError
            ? { detail: "max-iterations-error" }
            : undefined,
      },
    ],
    slots: {
      "max-iterations-control": control,
      "max-iterations-error": (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error ?? t(`${K}settingLoadFailed`)}
        </p>
      ),
    },
  };
}

function RowButton({
  children,
  destructive = false,
  onClick,
}: {
  children: ReactNode;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={destructive ? "outline-destructive" : "outline"}
      size="sm"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** A value the viewer can't change: a lock, with who can in its tooltip. */
function ReadOnlyValue({ value, tip }: { value: string; tip: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label={tip}
            className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconLock className="size-3.5" aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent>{tip}</TooltipContent>
      </Tooltip>
      {value}
    </span>
  );
}

function ModelPageSkeleton() {
  const t = useT();
  const group = (rows: number, key: string) => (
    <div key={key} className="grid gap-2.5">
      <Skeleton className="h-4 w-40" />
      <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6"
          >
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-56" />
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
    >
      {group(2, "org")}
      {group(1, "personal")}
      {group(3, "settings")}
    </div>
  );
}
