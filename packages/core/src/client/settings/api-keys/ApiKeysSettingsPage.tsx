import { Button } from "@agent-native/toolkit/ui/button";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  IconDots,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import type { AgentEngineKeyScope } from "../../agent-engine-key.js";
import type { AgentProviderId } from "../../agent-provider-catalog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { useFormatters, useT } from "../../i18n.js";
import {
  SENTENCE_LINK_TOKEN,
  SentenceWithLink,
  SettingsPageLink,
} from "../../integrations/settings-page-link.js";
import { useOrg } from "../../org/hooks.js";
import { useActionQuery } from "../../use-action.js";
import { ReadOnlySettingValue } from "../app-group/ReadOnlySettingValue.js";
import { ProviderDialog } from "../model/ProviderDialog.js";
import { SettingsGroup, SettingsRow } from "../SettingsRow.js";
import { useSettingsPageHeader } from "../shell/context.js";
import type { SettingsPageProps } from "../shell/registry.js";
import { testSavedApiKey } from "./api-keys-client.js";
import {
  apiKeyEntryId,
  apiKeyRowId,
  groupApiKeys,
  providerForKeyName,
  secretKeyFromHash,
  settingsRouteParts,
  usedByFeatures,
  type ApiKeyEntry,
  type ApiKeysListing,
} from "./api-keys-state.js";
import {
  DeleteKeyDialog,
  KeyValueDialog,
  type KeyValueDialogMode,
} from "./ApiKeyDialogs.js";

const K = "agentChat.settingsApiKeys.";
const M = "agentChat.settingsModel.";

type ProviderDialogState =
  | { mode: "manage"; provider: AgentProviderId; scope: AgentEngineKeyScope }
  | { mode: "add"; provider: AgentProviderId };

function useSecretKeyHash(): string | null {
  const read = () =>
    typeof window === "undefined"
      ? null
      : secretKeyFromHash(window.location.hash);
  const [key, setKey] = useState<string | null>(read);
  useEffect(() => {
    const update = () => setKey(read());
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return key;
}

/**
 * Settings › Connections › API keys (spec §5.5): Your keys, the
 * organization's keys for owners and admins, and keys managed by other
 * pages, read-only. Reads `list-api-keys`; deletes through `delete-api-key`.
 */
export default function ApiKeysSettingsPage({ context }: SettingsPageProps) {
  const t = useT();
  const org = useOrg();
  const listing = useActionQuery<ApiKeysListing>("list-api-keys" as never);
  const [valueDialog, setValueDialog] = useState<KeyValueDialogMode | null>(
    null,
  );
  const [deleting, setDeleting] = useState<ApiKeyEntry | null>(null);
  const [provider, setProvider] = useState<ProviderDialogState | null>(null);
  const hashKey = useSecretKeyHash();
  const handledHashKey = useRef<string | null>(null);

  const ready = !!listing.data;
  const header = useMemo(
    () => ({
      action: (
        <Button
          type="button"
          size="sm"
          className="h-8 px-3"
          disabled={!ready}
          onClick={() => setValueDialog({ mode: "add" })}
        >
          <IconPlus className="size-4" aria-hidden />
          {t(`${K}addKey`)}
        </Button>
      ),
    }),
    [ready, t],
  );
  useSettingsPageHeader(header);

  // A `#secrets:KEY` link for a key nobody saved yet opens the dialog that
  // can save it: the provider dialog for a model provider's key, whose value
  // Add key refuses, and Add key for anything else.
  useEffect(() => {
    if (!hashKey || !listing.data || handledHashKey.current === hashKey) {
      return;
    }
    handledHashKey.current = hashKey;
    const hashProvider = providerForKeyName(hashKey);
    const saved = listing.data.keys.some(
      (entry) =>
        entry.name === hashKey ||
        (!!hashProvider && entry.provider === hashProvider),
    );
    const managed = listing.data.managed.some(
      (entry) => entry.name === hashKey,
    );
    if (saved || managed) return;
    if (hashProvider) setProvider({ mode: "add", provider: hashProvider });
    else setValueDialog({ mode: "add", initialName: hashKey });
  }, [hashKey, listing.data]);

  if (listing.isError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 py-6 text-sm"
      >
        <p className="text-destructive">{t(`${K}loadFailed`)}</p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 px-3"
          onClick={() => void listing.refetch()}
        >
          {t(`${M}retry`)}
        </Button>
      </div>
    );
  }
  if (!listing.data || org.isLoading) return <ApiKeysPageSkeleton />;

  const data = listing.data;
  const orgName = org.data?.orgName ?? "";
  const groups = groupApiKeys(data, context.labs);
  const rowProps = {
    onManageProvider: (entry: ApiKeyEntry) =>
      entry.provider
        ? setProvider({
            mode: "manage",
            provider: entry.provider,
            scope: entry.scope,
          })
        : undefined,
    onReplace: (entry: ApiKeyEntry) =>
      setValueDialog({ mode: "replace", entry }),
    onDelete: setDeleting,
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-8" data-api-keys-settings="">
        <div>
          <SettingsGroup id="your-keys" title={t(`${K}yourKeys`)}>
            {groups.personal.length > 0 ? (
              groups.personal.map((entry) => (
                <KeyRow
                  key={apiKeyEntryId(entry)}
                  entry={entry}
                  {...rowProps}
                />
              ))
            ) : (
              <p className="px-5 py-4 text-sm text-muted-foreground sm:px-6">
                {t(`${K}noKeys`)}
              </p>
            )}
          </SettingsGroup>
          <p className="mt-2 px-1 text-xs leading-5 text-muted-foreground">
            <SentenceWithLink
              text={t(`${K}modelFootnote`, { link: SENTENCE_LINK_TOKEN })}
              link={
                <SettingsPageLink page="model">
                  {t(`${K}modelFootnoteLink`)}
                </SettingsPageLink>
              }
            />
          </p>
        </div>
        {groups.org.length > 0 ? (
          <SettingsGroup id="org-keys" title={t(`${K}orgKeys`)}>
            {groups.org.map((entry) => (
              <KeyRow key={apiKeyEntryId(entry)} entry={entry} {...rowProps} />
            ))}
          </SettingsGroup>
        ) : null}
        {groups.managed.length > 0 ? (
          <ManagedKeysGroup entries={groups.managed} orgName={orgName} />
        ) : null}
      </div>
      {valueDialog ? (
        <KeyValueDialog
          open
          onOpenChange={(open) => {
            if (!open) setValueDialog(null);
          }}
          dialog={valueDialog}
          listing={data}
          orgName={orgName}
        />
      ) : null}
      {deleting ? (
        <DeleteKeyDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          entry={deleting}
          orgName={orgName}
        />
      ) : null}
      <ProviderDialog
        open={provider !== null}
        onOpenChange={(open) => {
          if (!open) setProvider(null);
        }}
        {...(provider?.mode === "add"
          ? {
              mode: "add" as const,
              provider: provider.provider,
              providers: [provider.provider],
            }
          : {
              mode: "manage" as const,
              ...(provider
                ? { provider: provider.provider, scope: provider.scope }
                : {}),
            })}
      />
    </TooltipProvider>
  );
}

function UsedBy({ entry }: { entry: ApiKeyEntry }) {
  const t = useT();
  const formatters = useFormatters();
  const features = usedByFeatures(entry);
  if (!entry.provider && features.length === 0) return null;
  const rest = features.length > 0 ? formatters.formatList(features) : "";
  const link = entry.provider ? (
    <>
      <SettingsPageLink page="model">
        {t("agentChat.settingsShell.page.model")}
      </SettingsPageLink>
      {rest ? `, ${rest}` : null}
    </>
  ) : (
    rest
  );
  return (
    <SentenceWithLink
      text={t(`${K}usedBy`, { link: SENTENCE_LINK_TOKEN })}
      link={link}
    />
  );
}

function KeyRow({
  entry,
  onManageProvider,
  onReplace,
  onDelete,
}: {
  entry: ApiKeyEntry;
  onManageProvider: (entry: ApiKeyEntry) => void;
  onReplace: (entry: ApiKeyEntry) => void;
  onDelete: (entry: ApiKeyEntry) => void;
}) {
  const t = useT();
  const usedBy = <UsedBy entry={entry} />;
  const hasUse = !!entry.provider || usedByFeatures(entry).length > 0;
  const description: ReactNode = (
    <>
      {entry.masked ? <span className="font-mono">{entry.masked}</span> : null}
      {entry.masked && hasUse ? " · " : null}
      {hasUse ? usedBy : null}
    </>
  );

  let control: ReactNode = null;
  if (entry.vault) {
    control = (
      <ReadOnlySettingValue
        value={t("secrets.sourceVault")}
        reason={t("secrets.managedInVault")}
      />
    );
  } else if (entry.provider && entry.canDelete) {
    control = (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-8 px-3"
        onClick={() => onManageProvider(entry)}
      >
        {t(`${M}manage`)}
      </Button>
    );
  } else if (entry.canReplace || entry.canDelete) {
    control = (
      <KeyMenu
        entry={entry}
        onReplace={() => onReplace(entry)}
        onDelete={() => onDelete(entry)}
      />
    );
  }

  return (
    <SettingsRow
      id={apiKeyRowId(entry)}
      label={
        entry.label ?? (
          <span className="font-mono text-[13px]">{entry.name}</span>
        )
      }
      description={entry.masked || hasUse ? description : undefined}
      control={control}
    />
  );
}

function KeyMenu({
  entry,
  onReplace,
  onDelete,
}: {
  entry: ApiKeyEntry;
  onReplace: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const test = async () => {
    const result = await testSavedApiKey(entry.name);
    if (result.ok) toast.success(t(`${K}testPassed`));
    else toast.error(result.error);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="size-8 p-0"
          aria-label={t(`${K}manageKey`, { name: entry.name })}
        >
          <IconDots className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {entry.canTest ? (
          <DropdownMenuItem onSelect={() => void test()}>
            <IconPlugConnected className="size-4" aria-hidden />
            {t(`${K}test`)}
          </DropdownMenuItem>
        ) : null}
        {entry.canReplace ? (
          <DropdownMenuItem onSelect={onReplace}>
            <IconRefresh className="size-4" aria-hidden />
            {t(`${K}replaceValue`)}
          </DropdownMenuItem>
        ) : null}
        {entry.canDelete ? (
          <>
            {entry.canTest || entry.canReplace ? (
              <DropdownMenuSeparator />
            ) : null}
            <DropdownMenuItem
              onSelect={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <IconTrash className="size-4" aria-hidden />
              {t(`${K}deleteKey`)}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ManagedKeysGroup({
  entries,
  orgName,
}: {
  entries: ApiKeyEntry[];
  orgName: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <SettingsGroup id="managed-keys" title={t(`${K}managedKeys`)}>
      {open
        ? entries.map((entry) => {
            const owner = entry.managedBy!;
            const { page, sub } = settingsRouteParts(owner.route);
            return (
              <SettingsRow
                key={apiKeyEntryId(entry)}
                id={apiKeyRowId(entry)}
                label={
                  <span className="break-all font-mono text-[13px]">
                    {entry.name}
                  </span>
                }
                description={
                  <SentenceWithLink
                    text={t(`${K}usedBy`, { link: SENTENCE_LINK_TOKEN })}
                    link={
                      <SettingsPageLink page={page} sub={sub}>
                        {owner.owner}
                      </SettingsPageLink>
                    }
                  />
                }
                control={
                  <ReadOnlySettingValue
                    value={
                      entry.scope === "org" && orgName
                        ? orgName
                        : t(
                            entry.scope === "org"
                              ? `${M}organization`
                              : `${M}personal`,
                          )
                    }
                    reason={t(`${K}managedTooltip`, { owner: owner.owner })}
                  />
                }
              />
            );
          })
        : null}
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-start rounded-none px-5 py-3 text-sm font-normal text-muted-foreground hover:text-foreground sm:px-6"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open
          ? t(`${K}hideKeys`)
          : t(`${K}showKeys`, { count: entries.length })}
      </Button>
    </SettingsGroup>
  );
}

function ApiKeysPageSkeleton() {
  const t = useT();
  const group = (rows: number, key: string) => (
    <div key={key} className="grid gap-2.5">
      <Skeleton className="h-4 w-32" />
      <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6"
          >
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-36" />
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
      {group(2, "yours")}
      {group(1, "managed")}
    </div>
  );
}
