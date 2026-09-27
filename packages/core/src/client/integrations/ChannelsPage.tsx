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
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { Switch } from "@agent-native/toolkit/ui/switch";
import {
  IconAlertCircle,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconMessages,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState, type MouseEvent } from "react";

import type {
  BuiltInChannelId,
  IntegrationCatalogEntry,
} from "../../integrations/catalog.js";
import type {
  ChannelChangeResult,
  ChannelCredentialStatus,
  ChannelState,
  MessagingChannelsStatus,
  MessagingChannelStatus,
} from "../../integrations/channel-settings.js";
import { writeClipboardText } from "../clipboard.js";
import { submitToAgent } from "../CommandMenu.js";
import { useT } from "../i18n.js";
import { mcpIntegrationLogo } from "../resources/mcp-integration-logos.js";
import { McpIntegrationLogo } from "../resources/McpIntegrationLogo.js";
import { SettingsGroup, SettingsRow } from "../settings/SettingsRow.js";
import {
  useSettingsPageHeader,
  useSettingsShell,
} from "../settings/shell/context.js";
import type { SettingsPageContext } from "../settings/shell/registry.js";
import { settingsPageHref } from "../settings/shell/routing.js";
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "../use-action.js";
import { integrationBrand } from "./brand/integration-brands.js";
import { useChannelSettingsExtensions } from "./channel-extensions.js";
import {
  channelIcon,
  hasMissingRequiredCredentials,
  listChannelsForSettings,
} from "./channel-setup.js";
import {
  BrandLogo,
  BrandMark,
  BreadcrumbTitle,
  CopyField,
  IntegrationHero,
  LockedValue,
  RowValue,
} from "./IntegrationDetailParts.js";
import { isNonPublicWebhookUrl } from "./webhook-url.js";

const K = "agentChat.settingsShell.channels";
const PAGE_ID = "channels";
const LIST_ACTION = "list-messaging-channels";
const MANAGE_ACTION = "manage-messaging-channel";
const LIST_QUERY_KEY = ["action", LIST_ACTION] as const;

const STATE_KEYS: Record<ChannelState, string> = {
  on: `${K}.state.on`,
  off: `${K}.state.off`,
  "not-set-up": `${K}.state.notSetUp`,
};

const ABOUT_KEYS: Record<BuiltInChannelId, string> = {
  slack: `${K}.about.slack`,
  "google-docs": `${K}.about.googleDocs`,
  telegram: `${K}.about.telegram`,
  whatsapp: `${K}.about.whatsapp`,
  discord: `${K}.about.discord`,
  "microsoft-teams": `${K}.about.microsoftTeams`,
  email: `${K}.about.email`,
};

// The logo table's id for each channel. Email has no brand, so it keeps its
// icon.
const LOGO_IDS: Partial<Record<BuiltInChannelId, string>> = {
  slack: "slack",
  "google-docs": "google-workspace",
  telegram: "telegram",
  whatsapp: "whatsapp",
  discord: "discord",
  "microsoft-teams": "microsoft-teams",
};

function channelLogo(channel: IntegrationCatalogEntry) {
  const logoId = LOGO_IDS[channel.id as BuiltInChannelId];
  return { logoId, logoUrl: logoId ? mcpIntegrationLogo(logoId) : "" };
}

type ManageChannelArgs =
  | {
      operation: "save-credentials";
      platform: string;
      values: Record<string, string>;
    }
  | {
      operation:
        | "enable"
        | "disable"
        | "remove-credentials"
        | "register-webhook";
      platform: string;
    };

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

/** Every mounted channel, from the action the agent also reads. */
function useChannels() {
  return useActionQuery<MessagingChannelsStatus>(LIST_ACTION as never);
}

/** Channel changes go through the action the agent also calls; it checks roles. */
function useManageChannel() {
  return useActionMutation<ChannelChangeResult, ManageChannelArgs>(
    MANAGE_ACTION as never,
  );
}

function RowSkeleton({ link = false }: { link?: boolean }) {
  return (
    <div className="flex items-center gap-4 px-5 py-4 sm:px-6">
      <div className="flex min-w-0 flex-1 gap-3">
        <Skeleton className="size-8 shrink-0 rounded-md" />
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
      {link ? (
        <Skeleton className="size-4 shrink-0" />
      ) : (
        <Skeleton className="h-8 w-16 shrink-0" />
      )}
    </div>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <SettingsRow
      id="channels-error"
      label={t(`${K}.loadFailed`)}
      control={
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t(`${K}.retry`)}
        </Button>
      }
    />
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      onClick={async () => {
        if (await writeClipboardText(value)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      {copied ? (
        <IconCheck aria-hidden="true" />
      ) : (
        <IconCopy aria-hidden="true" />
      )}
    </Button>
  );
}

/**
 * A channel row. It opens the channel's own page, so the whole row is the
 * link and ends in a chevron instead of holding a button.
 */
function ChannelLinkRow({
  channel,
  description,
  ariaLabel,
}: {
  channel: IntegrationCatalogEntry;
  description?: string;
  ariaLabel: string;
}) {
  const { navigate } = useSettingsShell();
  const stateId = useId();
  return (
    <a
      id={channel.id}
      href={settingsPageHref(PAGE_ID, channel.id)}
      aria-label={ariaLabel}
      aria-describedby={description ? stateId : undefined}
      onClick={(event) => {
        if (isModifiedClick(event)) return;
        event.preventDefault();
        navigate(PAGE_ID, channel.id);
      }}
      className="agent-native-settings-row flex scroll-mt-16 items-center gap-4 px-5 py-4 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6"
    >
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <BrandLogo
          name={channel.name}
          {...channelLogo(channel)}
          icon={<ChannelIcon channel={channel} />}
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">
            {channel.name}
          </span>
          {description ? (
            <span
              id={stateId}
              className="mt-0.5 block text-sm leading-6 text-muted-foreground"
            >
              {description}
            </span>
          ) : null}
        </span>
      </span>
      <IconChevronRight
        className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100"
        aria-hidden="true"
      />
    </a>
  );
}

function ChannelIcon({ channel }: { channel: IntegrationCatalogEntry }) {
  const Icon = channelIcon(channel.iconKey);
  return <Icon aria-hidden="true" />;
}

function ChannelList({ appName }: { appName: string }) {
  const t = useT();
  const list = useChannels();
  const channels = listChannelsForSettings();
  // Only the adapters this deployment mounts (`integrations.platforms`).
  const statusById = useMemo(
    () =>
      new Map(
        (list.data?.channels ?? []).map((row) => [row.platform, row] as const),
      ),
    [list.data],
  );
  const available = channels.filter((channel) => statusById.has(channel.id));
  const canManage = list.data?.canManage === true;

  return (
    <div className="flex flex-col gap-8" data-channels-page="">
      <p className="text-sm leading-[1.6] text-muted-foreground">
        {t(`${K}.about.page`, { app: appName })}
      </p>
      <SettingsGroup id="channel-list">
        {list.isPending ? (
          channels.map((channel) => <RowSkeleton key={channel.id} link />)
        ) : list.isError ? (
          <LoadError onRetry={() => void list.refetch()} />
        ) : available.length === 0 ? (
          <Empty data-channels-empty="">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconMessages aria-hidden="true" />
              </EmptyMedia>
              <EmptyDescription>
                {t(`${K}.empty`, { app: appName })}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          available.map((channel) => {
            const state = statusById.get(channel.id)!.state;
            const action = !canManage
              ? "view"
              : state === "not-set-up"
                ? "setUp"
                : "manage";
            const aboutKey = ABOUT_KEYS[channel.id as BuiltInChannelId];
            // Slack's line is how to use it, which reads wrong before it's set up.
            return (
              <ChannelLinkRow
                key={channel.id}
                channel={channel}
                description={
                  aboutKey && channel.id !== "slack"
                    ? t(`${K}.rowDescription`, {
                        about: t(aboutKey),
                        state: t(STATE_KEYS[state]),
                      })
                    : t(STATE_KEYS[state])
                }
                ariaLabel={t(`${K}.action.${action}Aria`, {
                  platform: channel.name,
                })}
              />
            );
          })
        )}
      </SettingsGroup>
    </div>
  );
}

/** Turn a channel on or off, showing the new state before the server answers. */
function useToggleChannel(platform: string) {
  const queryClient = useQueryClient();
  const withEnabled = (enabled: boolean) => (data: unknown) => {
    const list = data as MessagingChannelsStatus | undefined;
    if (!list) return list;
    return {
      ...list,
      channels: list.channels.map((row) =>
        row.platform === platform
          ? {
              ...row,
              enabled,
              state: row.configured ? (enabled ? "on" : "off") : row.state,
            }
          : row,
      ),
    } satisfies MessagingChannelsStatus;
  };
  return useActionMutation<
    ChannelChangeResult,
    { operation: "enable" | "disable"; platform: string }
  >(MANAGE_ACTION as never, {
    onMutate: async ({ operation }) => {
      await queryClient.cancelQueries({ queryKey: LIST_QUERY_KEY });
      const previous = queryClient.getQueriesData({ queryKey: LIST_QUERY_KEY });
      queryClient.setQueriesData(
        { queryKey: LIST_QUERY_KEY },
        withEnabled(operation === "enable"),
      );
      return { previous };
    },
    onError: (_error, _args, snapshot) => {
      const previous = (
        snapshot as { previous?: Array<[readonly unknown[], unknown]> }
      )?.previous;
      for (const [key, data] of previous ?? []) {
        queryClient.setQueryData(key, data);
      }
      void queryClient.invalidateQueries({ queryKey: LIST_QUERY_KEY });
    },
  });
}

/** Adapter credentials with the catalog's Resend-or-SendGrid alternative. */
function withAlternatives(
  channel: IntegrationCatalogEntry,
  credentials: readonly ChannelCredentialStatus[],
) {
  const fromCatalog = new Map(
    channel.credentialRequirements.map((item) => [item.key, item]),
  );
  return credentials.map((item) => ({
    ...item,
    alternativeGroup: fromCatalog.get(item.key)?.alternativeGroup,
  }));
}

function CredentialValue({
  credential,
  inputId,
  editing,
  value,
  onChange,
  onReplace,
}: {
  credential: ChannelCredentialStatus;
  inputId: string;
  editing: boolean;
  value: string;
  onChange: (value: string) => void;
  onReplace: () => void;
}) {
  const t = useT();
  if (editing) {
    return (
      <Input
        id={inputId}
        type="password"
        autoComplete="off"
        aria-label={credential.label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (credential.source === "saved") {
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t(`${K}.setup.saved`)}</p>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          aria-label={t(`${K}.setup.replaceAria`, { key: credential.key })}
          onClick={onReplace}
        >
          {t(`${K}.setup.replace`)}
        </Button>
      </div>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      {credential.source === "environment"
        ? t(`${K}.setup.setInEnvironment`)
        : credential.source === "elsewhere"
          ? t(`${K}.setup.savedElsewhere`)
          : t(`${K}.setup.addToEnvironment`)}
    </p>
  );
}

function ChannelSetupDialog({
  open,
  onOpenChange,
  channel,
  status,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: IntegrationCatalogEntry;
  status: MessagingChannelStatus;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const manage = useManageChannel();
  const [values, setValues] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const state = status.state;
  const credentials = withAlternatives(channel, status.credentials);
  // An unset key the app can save gets an input; a saved one gets Replace.
  const isEditing = (item: ChannelCredentialStatus) =>
    item.saveable &&
    (item.source === null ||
      (item.source === "saved" && replacing.has(item.key)));
  const filled = credentials
    .filter(isEditing)
    .map((item) => [item.key, values[item.key]?.trim() ?? ""] as const)
    .filter(([, value]) => value);
  const stillMissing = hasMissingRequiredCredentials(
    credentials,
    (key) =>
      credentials.some((item) => item.key === key && item.source !== null) ||
      filled.some(([filledKey]) => filledKey === key),
  );
  const canSaveHere = credentials.some(
    (item) =>
      item.saveable && (item.source === null || item.source === "saved"),
  );
  const readOnly = !canSaveHere && state !== "off";
  const nothingToDo =
    filled.length === 0 && (state === "on" || state === "not-set-up");

  const reset = () => {
    setValues({});
    setReplacing(new Set());
    setError(null);
  };

  const save = useMutation({
    mutationFn: async (): Promise<"done" | "missing"> => {
      let next = status;
      if (filled.length > 0) {
        const saved = await manage.mutateAsync({
          operation: "save-credentials",
          platform: channel.id,
          values: Object.fromEntries(filled),
        });
        next = saved.channel;
      }
      if (state === "on") return "done";
      if (!next.configured) return "missing";
      await manage.mutateAsync({ operation: "enable", platform: channel.id });
      return "done";
    },
    onSuccess: (result) => {
      if (result === "missing") {
        setValues({});
        setReplacing(new Set());
        setError(t(`${K}.setup.stillMissing`));
        return;
      }
      reset();
      onOpenChange(false);
    },
    onError: (err) =>
      setError(actionErrorMessage(err) ?? t(`${K}.setup.failed`)),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: LIST_QUERY_KEY }),
  });

  const webhookUrl =
    channel.channelCapabilities?.webhookSetup === "manual"
      ? status.webhookUrl
      : null;
  const formId = `channel-setup-${channel.id}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (save.isPending) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t(`${K}.setup.title`, { platform: channel.name })}
          </DialogTitle>
          <DialogDescription>{t(`${K}.setup.body`)}</DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            save.mutate();
          }}
        >
          {credentials.map((item) => {
            const inputId = `channel-${channel.id}-${item.key}`;
            const editing = isEditing(item);
            return (
              <div
                key={item.key}
                className="grid gap-2"
                data-channel-credential={item.key}
              >
                <Label
                  htmlFor={editing ? inputId : undefined}
                  className="flex flex-wrap items-baseline gap-x-2"
                >
                  <span className="font-mono text-xs">{item.key}</span>
                  {item.required ? null : (
                    <span className="text-xs font-normal text-muted-foreground">
                      {t(`${K}.setup.optional`)}
                    </span>
                  )}
                </Label>
                <CredentialValue
                  credential={item}
                  inputId={inputId}
                  editing={editing}
                  value={values[item.key] ?? ""}
                  onChange={(value) =>
                    setValues((current) => ({ ...current, [item.key]: value }))
                  }
                  onReplace={() =>
                    setReplacing((current) => new Set(current).add(item.key))
                  }
                />
              </div>
            );
          })}
          {webhookUrl && !isNonPublicWebhookUrl(webhookUrl) ? (
            <div className="grid gap-2">
              <span className="text-sm font-medium leading-none text-foreground">
                {t(`${K}.webhookUrl`)}
              </span>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs text-foreground">
                  {webhookUrl}
                </code>
                <CopyButton
                  value={webhookUrl}
                  label={t(`${K}.copyWebhookUrl`)}
                />
              </div>
            </div>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <IconAlertCircle aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </form>
        <DialogFooter className="gap-2 sm:space-x-0">
          {readOnly ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              {t(`${K}.setup.close`)}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={save.isPending}
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                form={formId}
                disabled={save.isPending || nothingToDo || stillMissing}
                aria-busy={save.isPending}
              >
                {save.isPending ? <Spinner aria-hidden="true" /> : null}
                {save.isPending
                  ? t(`${K}.setup.saving`)
                  : state === "on"
                    ? t(`${K}.setup.save`)
                    : t(`${K}.setup.saveAndTurnOn`)}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveCredentialsDialog({
  open,
  onOpenChange,
  channel,
  keys,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: IntegrationCatalogEntry;
  keys: readonly string[];
}) {
  const t = useT();
  const remove = useManageChannel();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (remove.isPending) return;
        if (!next) remove.reset();
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(`${K}.removeCredentials.title`, { platform: channel.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(`${K}.removeCredentials.body`, { platform: channel.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex flex-col gap-1 font-mono text-xs text-foreground">
          {keys.map((key) => (
            <li key={key}>{key}</li>
          ))}
        </ul>
        {remove.isError ? (
          <Alert variant="destructive">
            <IconAlertCircle aria-hidden="true" />
            <AlertDescription>
              {actionErrorMessage(remove.error) ??
                t(`${K}.removeCredentials.failed`)}
            </AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel asChild disabled={remove.isPending}>
            <Button type="button" variant="secondary">
              {t("common.cancel")}
            </Button>
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={remove.isPending}
            aria-busy={remove.isPending}
            onClick={() =>
              remove.mutate(
                { operation: "remove-credentials", platform: channel.id },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {remove.isPending ? <Spinner aria-hidden="true" /> : null}
            {remove.isPending
              ? t(`${K}.removeCredentials.removing`)
              : t(`${K}.removeCredentials.confirm`)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RegisterWebhookControl({ platform }: { platform: string }) {
  const t = useT();
  const register = useManageChannel();
  if (register.isSuccess) {
    return (
      <span className="text-xs text-muted-foreground">
        {t(`${K}.webhookRegistered`)}
      </span>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={register.isPending}
      aria-busy={register.isPending}
      onClick={() =>
        register.mutate({ operation: "register-webhook", platform })
      }
    >
      {register.isPending ? <Spinner aria-hidden="true" /> : null}
      {t(`${K}.registerWebhook`)}
    </Button>
  );
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="link" size="sm">
      <a href={href} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    </Button>
  );
}

function ChannelDetail({
  channel,
  context,
  appName,
}: {
  channel: IntegrationCatalogEntry;
  context: SettingsPageContext;
  appName: string;
}) {
  const t = useT();
  const list = useChannels();
  const status = list.data?.channels.find((row) => row.platform === channel.id);
  const state = status?.state ?? null;
  const canManage = list.data?.canManage === true;
  const extensions = useChannelSettingsExtensions(channel.id);
  const toggle = useToggleChannel(channel.id);
  const [setupOpen, setSetupOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  // Slack's page is two groups (spec §5.19): the app's own Slack settings,
  // and the agent in Slack, whose Set up sits on its row.
  const isSlack = channel.id === "slack";
  const { logoId, logoUrl } = channelLogo(channel);
  const brand = integrationBrand(channel.id);

  const header = useMemo(
    () => ({
      title: (
        <BreadcrumbTitle
          name={channel.name}
          mark={
            <BrandMark
              logoUrl={logoUrl}
              logoId={logoId}
              icon={<ChannelIcon channel={channel} />}
              className="size-4 rounded-[3px]"
            />
          }
        />
      ),
      action:
        canManage && state && !isSlack ? (
          <Button type="button" size="sm" onClick={() => setSetupOpen(true)}>
            {state === "not-set-up"
              ? t(`${K}.action.setUp`)
              : t(`${K}.action.manage`)}
          </Button>
        ) : null,
    }),
    [canManage, channel, isSlack, logoId, logoUrl, state, t],
  );
  useSettingsPageHeader(header);

  const aboutKey = ABOUT_KEYS[channel.id as BuiltInChannelId];
  const prompts = (brand?.prompts ?? []).map((key) => t(key, { app: appName }));
  const webhookSetup = channel.channelCapabilities?.webhookSetup;
  const webhookUrl = webhookSetup ? status?.webhookUrl : null;
  const serviceAccountEmail =
    typeof status?.details?.serviceAccountEmail === "string"
      ? status.details.serviceAccountEmail
      : null;
  const removableKeys = canManage
    ? (status?.credentials ?? [])
        .filter((item) => item.removable)
        .map((item) => item.key)
    : [];
  const setUp = state !== null && state !== "not-set-up";

  const mentionRow =
    isSlack && aboutKey ? (
      <SettingsRow
        id="mention"
        label={t(`${K}.mentionAgent`)}
        description={t(aboutKey)}
        control={
          canManage ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSetupOpen(true)}
            >
              {setUp ? t(`${K}.action.manage`) : t(`${K}.action.setUp`)}
            </Button>
          ) : state ? (
            <LockedValue
              value={t(STATE_KEYS[state])}
              reason={t(`${K}.setUpLocked`)}
            />
          ) : null
        }
      />
    ) : null;

  return (
    <div className="flex flex-col gap-8" data-channel-page={channel.id}>
      {!isSlack && (prompts.length > 0 || aboutKey) ? (
        <div className="flex flex-col gap-5">
          {prompts.length > 0 ? (
            <IntegrationHero
              name={channel.name}
              hue={brand?.hue}
              mark={
                <BrandMark
                  logoUrl={logoUrl}
                  logoId={logoId}
                  className="size-[15px]"
                />
              }
              heroMark={
                <McpIntegrationLogo
                  name={channel.name}
                  logoUrl={logoUrl}
                  integrationId={logoId}
                  className="size-12 rounded-xl shadow-sm"
                />
              }
              prompts={prompts}
              onAsk={submitToAgent}
            />
          ) : null}
          {aboutKey ? (
            <p className="max-w-[680px] px-0.5 text-sm leading-[1.6] text-muted-foreground">
              {t(aboutKey)} {t(`${K}.separately`)}
            </p>
          ) : null}
        </div>
      ) : null}

      {extensions.map((extension) => (
        <extension.component
          key={extension.id}
          platform={channel.id}
          context={context}
        />
      ))}

      {list.isSuccess && !status ? (
        <p className="text-sm text-muted-foreground">
          {t(`${K}.unavailable`, { platform: channel.name, app: appName })}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <SettingsGroup
            id="connection"
            title={
              isSlack
                ? t(`${K}.agentIn`, { platform: channel.name })
                : t(`${K}.connection`)
            }
          >
            {list.isPending ? (
              <>
                <RowSkeleton />
                <RowSkeleton />
              </>
            ) : list.isError || !status || !state ? (
              <LoadError onRetry={() => void list.refetch()} />
            ) : (
              <>
                {mentionRow}
                {/* Before setup the header's Set up says the state; a card
                    with nothing else in it still names it. */}
                {setUp || (!isSlack && !webhookUrl) ? (
                  <SettingsRow
                    id="status"
                    label={t(`${K}.status`)}
                    description={t(STATE_KEYS[state])}
                    control={
                      canManage && setUp ? (
                        <Switch
                          checked={status.enabled}
                          disabled={toggle.isPending}
                          aria-label={t(`${K}.turnOnAria`, {
                            platform: channel.name,
                          })}
                          onCheckedChange={(enabled) =>
                            toggle.mutate({
                              operation: enabled ? "enable" : "disable",
                              platform: channel.id,
                            })
                          }
                        />
                      ) : null
                    }
                  />
                ) : null}
                {webhookUrl && (!isSlack || setUp) ? (
                  <SettingsRow
                    id="webhook-url"
                    label={t(`${K}.webhookUrl`)}
                    description={
                      isNonPublicWebhookUrl(webhookUrl)
                        ? t(`${K}.webhookLocalOnly`, {
                            platform: channel.name,
                          })
                        : undefined
                    }
                    control={
                      isNonPublicWebhookUrl(webhookUrl) ? null : (
                        <CopyField
                          value={webhookUrl}
                          label={t(`${K}.copyWebhookUrl`)}
                        />
                      )
                    }
                  />
                ) : null}
                {/* The provider registers the public URL it will call, so a
                    local address would only fail upstream. */}
                {webhookSetup === "automatic" &&
                webhookUrl &&
                !isNonPublicWebhookUrl(webhookUrl) &&
                canManage &&
                setUp ? (
                  <SettingsRow
                    id="webhook-registration"
                    label={t(`${K}.webhookRegistration`)}
                    control={<RegisterWebhookControl platform={channel.id} />}
                  />
                ) : null}
                {serviceAccountEmail ? (
                  <SettingsRow
                    id="service-account"
                    label={t(`${K}.shareDocumentsWith`)}
                    control={
                      <CopyField
                        value={serviceAccountEmail}
                        label={t(`${K}.copyServiceAccountEmail`)}
                      />
                    }
                  />
                ) : null}
                {removableKeys.length > 0 ? (
                  <SettingsRow
                    id="credentials"
                    label={t(`${K}.credentials`)}
                    description={
                      <span className="break-all font-mono text-xs">
                        {removableKeys.join(", ")}
                      </span>
                    }
                    control={
                      <Button
                        type="button"
                        variant="outline-destructive"
                        size="sm"
                        aria-label={t(`${K}.removeCredentials.aria`, {
                          platform: channel.name,
                        })}
                        onClick={() => setRemoveOpen(true)}
                      >
                        {t(`${K}.removeCredentials.action`)}
                      </Button>
                    }
                  />
                ) : null}
              </>
            )}
          </SettingsGroup>
          {toggle.isError ? (
            <p role="alert" className="text-xs text-destructive">
              {actionErrorMessage(toggle.error) ??
                t(`${K}.toggleFailed`, { platform: channel.name })}
            </p>
          ) : null}
          {list.isSuccess && !canManage && !isSlack ? (
            <p className="text-xs leading-5 text-muted-foreground">
              {t(`${K}.membersFootnote`)}
            </p>
          ) : null}
        </div>
      )}

      {isSlack ? null : (
        <SettingsGroup id="information" title={t(`${K}.information`)}>
          {brand ? (
            <SettingsRow
              id="developer"
              label={t(`${K}.developer`)}
              control={<RowValue>{brand.developer}</RowValue>}
            />
          ) : null}
          <SettingsRow
            id="category"
            label={t(`${K}.category`)}
            control={
              <RowValue>{t("agentChat.settingsShell.page.channels")}</RowValue>
            }
          />
          <SettingsRow
            id="documentation"
            label={t(`${K}.documentation`)}
            control={
              <ExternalLink
                href={channel.documentation.href}
                label={t(`${K}.openDocs`)}
              />
            }
          />
          {channel.documentation.externalHref ? (
            <SettingsRow
              id="developer-site"
              label={t(`${K}.developerSite`)}
              control={
                <ExternalLink
                  href={channel.documentation.externalHref}
                  label={t(`${K}.open`)}
                />
              }
            />
          ) : null}
        </SettingsGroup>
      )}

      {canManage && status ? (
        <>
          <ChannelSetupDialog
            open={setupOpen}
            onOpenChange={setSetupOpen}
            channel={channel}
            status={status}
          />
          <RemoveCredentialsDialog
            open={removeOpen}
            onOpenChange={setRemoveOpen}
            channel={channel}
            keys={removableKeys}
          />
        </>
      ) : null}
    </div>
  );
}

function ChannelNotFound({ appName }: { appName: string }) {
  const t = useT();
  const header = useMemo(
    () => ({
      title: t("agentChat.settingsShell.integrationDetail.notFoundTitle"),
    }),
    [t],
  );
  useSettingsPageHeader(header);
  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
      <Empty data-channel-not-found="">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconMessages aria-hidden="true" />
          </EmptyMedia>
          <EmptyDescription>
            {t(`${K}.notFound`, { app: appName })}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

export interface ChannelsPageProps {
  /** A channel's catalog id opens its page. */
  sub: string | null;
  context: SettingsPageContext;
  appName: string;
}

/**
 * {App} › Channels (spec §5.19): everywhere people can message this app's
 * agent, from the channel catalog, with each adapter's own required
 * variables. Reads and changes go through `list-messaging-channels` and
 * `manage-messaging-channel`, the actions the agent calls too; the second
 * allows owners and admins only.
 */
export function ChannelsPage({ sub, context, appName }: ChannelsPageProps) {
  if (!sub) return <ChannelList appName={appName} />;
  const channel = listChannelsForSettings().find((entry) => entry.id === sub);
  if (!channel) return <ChannelNotFound appName={appName} />;
  return (
    <ChannelDetail
      key={channel.id}
      channel={channel}
      context={context}
      appName={appName}
    />
  );
}
