import { Badge } from "@agent-native/toolkit/ui/badge";
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
import { Switch } from "@agent-native/toolkit/ui/switch";
import { IconCpu, IconLock, IconPlus } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";

import type { ProviderKeyPolicyStatus } from "../../../agent/actions/manage-provider-key-policy.js";
import { CHATGPT_SUBSCRIPTION_LAB_KEY } from "../../../agent/chatgpt-subscription-contract.js";
import {
  setAgentEngineDefaultModel,
  type AgentEngineKeyScope,
} from "../../agent-engine-key.js";
import {
  fetchAgentLoopSettings,
  saveAgentLoopMaxIterations,
  type AgentLoopSettingsStatus,
} from "../../agent-loop-settings.js";
import {
  getAgentProviderOption,
  type AgentProviderId,
} from "../../agent-provider-catalog.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";
import { useFormatters, useT } from "../../i18n.js";
import { useLabState } from "../../labs/use-lab.js";
import { useOrg } from "../../org/hooks.js";
import {
  ErrorRow,
  SettingsEmpty,
} from "../../resources/ResourceSettingsGroups.js";
import { callAction, useActionQuery } from "../../use-action.js";
import { DeferredBuilderConnectPopover } from "../deferred-builder-connect-popover.js";
import { SettingsGroup, SettingsRow } from "../SettingsRow.js";
import { useSettingsPageHeader, useSettingsShell } from "../shell/context.js";
import type { SettingsPageProps } from "../shell/registry.js";
import {
  useBuilderConnectFlow,
  type BuilderConnectFlow,
  type BuilderConnectionScope,
} from "../useBuilderStatus.js";
import { ChatGPTSubscriptionRow } from "./ChatGPTSubscriptionRow.js";
import {
  addableProviders,
  defaultModelGroups,
  defaultModelValue,
  keyDetailParts,
  parseDefaultModelValue,
  providerForEngine,
  providerRows,
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
const LOOP_QUERY_KEY = [
  "action",
  "manage-agent-loop-settings",
  { action: "get" },
] as const;

type DialogState =
  | { mode: "add" }
  | { mode: "manage"; provider: AgentProviderId; scope: AgentEngineKeyScope };

/** `get-provider-models`, kept apart so a failed read never reads as "no models". */
type ModelsReadState =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "ready"; data: ProviderModelsRead };

/**
 * Settings › Agent › Model: Organization providers, Personal providers, and
 * Organization settings (spec §5.6). Every control writes through an action
 * or its named client helper; the page only arranges what they return.
 */
export default function ModelSettingsPage(_props: SettingsPageProps) {
  const t = useT();
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
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [removing, setRemoving] = useState<ProviderKeyRow | null>(null);

  const canAdd = listing.data
    ? addableProviders(listing.data).length > 0
    : false;
  const needsProvider = listing.data
    ? !hasAnyProvider(
        listing.data,
        providerRows(listing.data, models.data),
        builder,
      )
    : false;
  // The empty state carries the page's actions, so the header stays empty
  // while it shows: one primary on screen.
  const header = useMemo(
    () => ({
      action:
        canAdd && !needsProvider ? (
          <AddProviderButton onClick={() => setDialog({ mode: "add" })} />
        ) : undefined,
    }),
    [canAdd, needsProvider],
  );
  useSettingsPageHeader(header);

  if (listing.isError) {
    return (
      <SettingsGroup>
        <ErrorRow
          text={t(`${K}loadFailed`)}
          onRetry={() => void listing.refetch()}
        />
      </SettingsGroup>
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
    setDialog({ mode: "manage", provider: row.provider, scope: row.key.scope });

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-8" data-model-settings="">
        {needsProvider ? (
          <SettingsGroup id="llm">
            <NoProviderEmpty
              listing={data}
              canAdd={canAdd}
              builder={builder}
              onAdd={() => setDialog({ mode: "add" })}
            />
          </SettingsGroup>
        ) : data.hasOrganization ? (
          // #llm is where legacy links to the old LLM section land.
          <SettingsGroup id="llm" title={t(`${K}orgProviders`)}>
            <BuilderRow
              scope="org"
              flow={builder}
              canManage={data.canManageOrg}
              orgName={orgName}
            />
            {rows.org.map((row) => (
              <KeyProviderRow
                key={row.provider}
                row={row}
                canManage={data.canManageOrg}
                modelsLoading={modelsRead.status === "loading"}
                onManage={() => openManage(row)}
                onRemove={() => setRemoving(row)}
              />
            ))}
          </SettingsGroup>
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
          builder={builder}
          hasProvider={!needsProvider}
        />
      </div>
      <ProviderDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        mode={dialog?.mode ?? "add"}
        {...(dialog?.mode === "manage"
          ? { provider: dialog.provider, scope: dialog.scope }
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
 * Whether the agent has a provider to answer with: a connected Builder.io or
 * an organization key, or for members (while personal API keys aren't
 * restricted) and people without an organization, one of their own. Unknown
 * Builder.io status counts as a provider, so the empty state never flashes
 * before the status read answers.
 */
function hasAnyProvider(
  listing: ModelProvidersListing,
  rows: { org: ProviderKeyRow[]; personal: ProviderKeyRow[] },
  builder: BuilderConnectFlow,
): boolean {
  if (!builder.hasFetchedStatus) return true;
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
          ? t(`${K}connecting`)
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
  const chatgptLab = useLabState(CHATGPT_SUBSCRIPTION_LAB_KEY);
  const restricted = listing.personalKeysRestricted;
  const personalGrant = builder.grants?.personal;
  // Owners and admins connect Builder.io for the organization (open question
  // 8.1.1), so only members, and people without one, get a personal row.
  const showBuilder =
    !hideBuilder &&
    (listing.hasOrganization
      ? !listing.canManageOrg && (!!personalGrant || !restricted)
      : true);
  const showChatgpt = chatgptLab.enabled;
  const hasRows = showBuilder || rows.length > 0 || showChatgpt;

  // The no-provider empty state already says what a restricted member can do.
  if (!hasRows && (!restricted || hideBuilder)) return null;
  return (
    <div>
      <SettingsGroup
        id={
          listing.hasOrganization || hideBuilder ? "personal-providers" : "llm"
        }
        title={t(`${K}personalProviders`)}
      >
        {showBuilder ? (
          <BuilderRow
            scope="personal"
            flow={builder}
            canManage
            orgName={orgName}
            hasOrganization={listing.hasOrganization}
            restricted={restricted}
          />
        ) : null}
        {rows.map((row) => (
          <KeyProviderRow
            key={row.provider}
            row={row}
            canManage
            modelsLoading={modelsLoading}
            onManage={() => onManage(row)}
            onRemove={() => onRemove(row)}
          />
        ))}
        {showChatgpt ? <ChatGPTSubscriptionRow /> : null}
        {!hasRows ? (
          <SettingsEmpty icon={IconLock} title={t(`${K}restricted`)} />
        ) : null}
      </SettingsGroup>
      {restricted && hasRows ? (
        <p className="mt-2 px-1 text-xs leading-5 text-muted-foreground">
          {t(`${K}restricted`)}
        </p>
      ) : null}
    </div>
  );
}

function BuilderRow({
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
}) {
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

  let description: ReactNode;
  if (!flow.hasFetchedStatus) {
    // The description renders in a <p>, so the placeholder is inline.
    description = (
      <span
        aria-hidden
        className="skeleton-shimmer inline-block h-4 w-56 rounded-md bg-muted align-middle"
      />
    );
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

  const openPage = () => navigate("integrations", "builder");
  const mayConnect = hasOrganization ? flow.canConnect[scope] : true;
  let control: ReactNode = null;
  let recommended = false;
  if (flow.hasFetchedStatus) {
    if (connected || (flow.grants === null && hasOrganization)) {
      control = (
        <RowButton onClick={openPage}>
          {canManage ? t(`${K}manage`) : t(`${K}view`)}
        </RowButton>
      );
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
            {flow.connecting ? t(`${K}connecting`) : t(`${K}connect`)}
          </Button>
        </DeferredBuilderConnectPopover>
      );
    }
  }

  return (
    <SettingsRow
      id={`provider-${scope}-builder`}
      label={BUILDER_LABEL}
      status={
        recommended ? (
          <Badge variant="outline">
            {t("agentChat.integrations.recommended")}
          </Badge>
        ) : undefined
      }
      description={description}
      control={control}
    >
      {flow.error ? (
        <p role="alert" className="text-sm text-destructive">
          {flow.error}
        </p>
      ) : null}
    </SettingsRow>
  );
}

function KeyProviderRow({
  row,
  canManage,
  modelsLoading,
  onManage,
  onRemove,
}: {
  row: ProviderKeyRow;
  canManage: boolean;
  modelsLoading: boolean;
  onManage: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const formatters = useFormatters();
  const { key } = row;

  let description: ReactNode;
  let control: ReactNode = null;
  if (key.rejectedAt) {
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
    if (canManage) {
      control = <RowButton onClick={onManage}>{t(`${K}replaceKey`)}</RowButton>;
    }
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
    if (canManage) {
      control = <RowButton onClick={onManage}>{t(`${K}manage`)}</RowButton>;
    }
  }

  return (
    <SettingsRow
      id={`provider-${key.scope === "org" ? "org" : "personal"}-${row.provider}`}
      label={row.label}
      description={description || undefined}
      control={control}
    />
  );
}

function OrganizationSettingsGroup({
  listing,
  models,
  builder,
  hasProvider,
}: {
  listing: ModelProvidersListing;
  models: ModelsReadState;
  builder: BuilderConnectFlow;
  hasProvider: boolean;
}) {
  const t = useT();
  const hasOrg = listing.hasOrganization;
  return (
    // #limits is where legacy links to the old Agent Limits section land.
    <SettingsGroup
      id="limits"
      title={hasOrg ? t(`${K}orgSettings`) : undefined}
    >
      <DefaultModelRow
        listing={listing}
        models={models}
        builder={builder}
        hasProvider={hasProvider}
      />
      {hasOrg && listing.canManageOrg ? <RestrictKeysRow /> : null}
      <MaxIterationsRow />
    </SettingsGroup>
  );
}

function DefaultModelRow({
  listing,
  models: modelsRead,
  builder,
  hasProvider,
}: {
  listing: ModelProvidersListing;
  models: ModelsReadState;
  builder: BuilderConnectFlow;
  hasProvider: boolean;
}) {
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
  });
  const stored = listing.defaultModel
    ? {
        engine: listing.defaultModel.engine,
        model:
          listing.defaultModel.model ??
          groups.find((group) => group.engine === listing.defaultModel?.engine)
            ?.models[0] ??
          "",
      }
    : null;
  const current = pending ?? stored;
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
  // A stored default no longer offered (personal, rejected, or unchecked)
  // still shows as the value, so the select never reads blank.
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

  return (
    <SettingsRow
      id="default-model"
      label={t(DEFAULT_MODEL_LABEL)}
      description={
        waitingForProvider
          ? t(`${K}defaultModelNeedsProvider`)
          : t(`${K}defaultModelDescription`)
      }
      control={
        modelsRead.status === "loading" ? (
          <Skeleton
            className="h-8 w-64 max-w-full"
            data-default-model-loading=""
          />
        ) : modelsRead.status === "error" ? null : waitingForProvider ||
          (listing.canUpdateDefault && allGroups.length === 0) ? (
          <Select disabled>
            <SelectTrigger
              size="sm"
              className="w-64 max-w-full"
              aria-label={t(DEFAULT_MODEL_LABEL)}
            >
              <SelectValue
                placeholder={current ? currentLabel : t(`${K}chooseModel`)}
              />
            </SelectTrigger>
          </Select>
        ) : listing.canUpdateDefault ? (
          <Select
            value={
              current?.model
                ? defaultModelValue(current.engine, current.model)
                : undefined
            }
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
                      {t(`${K}modelOption`, { model, provider: group.label })}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <ReadOnlyValue value={currentLabel} tip={t(`${K}lockedTip`)} />
        )
      }
    >
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {modelsRead.status === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <p className="text-destructive">{t(`${K}settingLoadFailed`)}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={modelsRead.retry}
          >
            {t("agentChat.common.retry")}
          </Button>
        </div>
      ) : null}
    </SettingsRow>
  );
}

function RestrictKeysRow() {
  const t = useT();
  const queryClient = useQueryClient();
  const policy = useQuery({
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
  const label = t(`${K}restrictLabel`);
  return (
    <>
      <SettingsRow
        id="restrict-personal-keys"
        label={label}
        description={t(`${K}restrictDescription`)}
        control={
          policy.data ? (
            <Switch
              checked={checked}
              aria-label={label}
              disabled={pending !== null}
              onCheckedChange={(next) => {
                setError(null);
                if (next) setConfirmOpen(true);
                else void unrestrict();
              }}
            />
          ) : policy.isError ? null : (
            <Skeleton className="h-4.5 w-8 rounded-full" />
          )
        }
      >
        {error || policy.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {error ?? t(`${K}settingLoadFailed`)}
          </p>
        ) : null}
      </SettingsRow>
      <RestrictKeysDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        affectedMembers={policy.data?.affectedMembers}
        onConfirm={() => write(true)}
      />
    </>
  );
}

function MaxIterationsRow() {
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

  return (
    <SettingsRow
      id="max-iterations"
      label={label}
      description={t(`${K}maxIterationsDescription`)}
      control={control}
    >
      {error || loop.isError ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error ?? t(`${K}settingLoadFailed`)}
        </p>
      ) : null}
    </SettingsRow>
  );
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
