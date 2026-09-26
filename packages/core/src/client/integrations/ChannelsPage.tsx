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
import { Input } from "@agent-native/toolkit/ui/input";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { Switch } from "@agent-native/toolkit/ui/switch";
import {
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconLoader2,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type MouseEvent } from "react";

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
import { useT } from "../i18n.js";
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
import { useChannelSettingsExtensions } from "./channel-extensions.js";
import {
  channelIcon,
  hasMissingRequiredCredentials,
  listChannelsForSettings,
} from "./channel-setup.js";
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

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-5 py-4 sm:px-6">
      <Skeleton className="size-8 rounded-md" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="h-8 w-16 rounded-md" />
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 px-3 text-xs"
          onClick={onRetry}
        >
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
      size="icon"
      className="size-8"
      aria-label={label}
      onClick={async () => {
        if (await writeClipboardText(value)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      {copied ? (
        <IconCheck className="size-4" aria-hidden="true" />
      ) : (
        <IconCopy className="size-4" aria-hidden="true" />
      )}
    </Button>
  );
}

function OpenChannelLink({
  platform,
  label,
  ariaLabel,
}: {
  platform: string;
  label: string;
  ariaLabel: string;
}) {
  const { navigate } = useSettingsShell();
  return (
    <Button asChild variant="outline" size="sm" className="h-8 px-3 text-xs">
      <a
        href={settingsPageHref(PAGE_ID, platform)}
        aria-label={ariaLabel}
        onClick={(event) => {
          if (isModifiedClick(event)) return;
          event.preventDefault();
          navigate(PAGE_ID, platform);
        }}
      >
        {label}
      </a>
    </Button>
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
      <p className="text-sm leading-6 text-muted-foreground">
        {t(`${K}.about.page`, { app: appName })}
      </p>
      {list.isSuccess && available.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t(`${K}.empty`, { app: appName })}
        </p>
      ) : (
        <SettingsGroup id="channel-list">
          {list.isPending ? (
            channels.map((channel) => <RowSkeleton key={channel.id} />)
          ) : list.isError ? (
            <LoadError onRetry={() => void list.refetch()} />
          ) : (
            available.map((channel) => {
              const state = statusById.get(channel.id)!.state;
              const action = !canManage
                ? "view"
                : state === "not-set-up"
                  ? "setUp"
                  : "manage";
              return (
                <SettingsRow
                  key={channel.id}
                  id={channel.id}
                  icon={<ChannelIcon channel={channel} />}
                  label={channel.name}
                  description={t(STATE_KEYS[state])}
                  control={
                    <OpenChannelLink
                      platform={channel.id}
                      label={t(`${K}.action.${action}`)}
                      ariaLabel={t(`${K}.action.${action}Aria`, {
                        platform: channel.name,
                      })}
                    />
                  }
                />
              );
            })
          )}
        </SettingsGroup>
      )}
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
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
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
                className="flex flex-col gap-1.5"
                data-channel-credential={item.key}
              >
                <label
                  htmlFor={editing ? inputId : undefined}
                  className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-foreground"
                >
                  <span className="font-mono text-xs">{item.key}</span>
                  {item.required ? null : (
                    <span className="text-xs font-normal text-muted-foreground">
                      {t(`${K}.setup.optional`)}
                    </span>
                  )}
                </label>
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
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">
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
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          {readOnly ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t(`${K}.setup.close`)}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
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
                {save.isPending ? (
                  <IconLoader2
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                {state === "on"
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
          <p role="alert" className="text-xs text-destructive">
            {actionErrorMessage(remove.error) ??
              t(`${K}.removeCredentials.failed`)}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>
            {t("common.cancel")}
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
            {remove.isPending ? (
              <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            {t(`${K}.removeCredentials.confirm`)}
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
      className="h-8 px-3 text-xs"
      disabled={register.isPending}
      aria-busy={register.isPending}
      onClick={() =>
        register.mutate({ operation: "register-webhook", platform })
      }
    >
      {register.isPending ? (
        <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : null}
      {t(`${K}.registerWebhook`)}
    </Button>
  );
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline"
    >
      {label}
      <IconExternalLink className="size-3.5" aria-hidden="true" />
    </a>
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

  const header = useMemo(
    () =>
      canManage && state
        ? {
            action: (
              <Button
                type="button"
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={() => setSetupOpen(true)}
              >
                {state === "not-set-up"
                  ? t(`${K}.action.setUp`)
                  : t(`${K}.action.manage`)}
              </Button>
            ),
          }
        : null,
    [canManage, state, t],
  );
  useSettingsPageHeader(header);

  const aboutKey = ABOUT_KEYS[channel.id as BuiltInChannelId];
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

  return (
    <div className="flex flex-col gap-8" data-channel-page={channel.id}>
      {aboutKey ? (
        <p className="text-sm leading-6 text-muted-foreground">{t(aboutKey)}</p>
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
              extensions.length > 0
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
                <SettingsRow
                  id="status"
                  label={t(`${K}.status`)}
                  description={t(STATE_KEYS[state])}
                  control={
                    canManage && state !== "not-set-up" ? (
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
                {webhookUrl ? (
                  <SettingsRow
                    id="webhook-url"
                    label={t(`${K}.webhookUrl`)}
                    description={
                      isNonPublicWebhookUrl(webhookUrl) ? (
                        t(`${K}.webhookLocalOnly`, { platform: channel.name })
                      ) : (
                        <code className="break-all font-mono text-xs text-foreground">
                          {webhookUrl}
                        </code>
                      )
                    }
                    control={
                      isNonPublicWebhookUrl(webhookUrl) ? null : (
                        <CopyButton
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
                state !== "not-set-up" ? (
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
                    description={
                      <code className="break-all font-mono text-xs text-foreground">
                        {serviceAccountEmail}
                      </code>
                    }
                    control={
                      <CopyButton
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
                        variant="outline"
                        size="sm"
                        className="h-8 px-3 text-xs"
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
          {list.isSuccess && !canManage ? (
            <p className="text-xs leading-5 text-muted-foreground">
              {t(`${K}.membersFootnote`)}
            </p>
          ) : null}
        </div>
      )}

      <SettingsGroup id="information" title={t(`${K}.information`)}>
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
  const t = useT();
  if (!sub) return <ChannelList appName={appName} />;
  const channel = listChannelsForSettings().find((entry) => entry.id === sub);
  if (!channel) {
    return (
      <p className="text-sm text-muted-foreground">
        {t(`${K}.notFound`, { app: appName })}
      </p>
    );
  }
  return (
    <ChannelDetail
      key={channel.id}
      channel={channel}
      context={context}
      appName={appName}
    />
  );
}
