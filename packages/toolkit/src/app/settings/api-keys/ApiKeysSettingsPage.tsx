import type { AgentEngineKeyScope } from "@agent-native/core/client/agent-engine-key";
import type { AgentProviderId } from "@agent-native/core/client/agent-provider-catalog";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import {
  type ModelRow,
  rowAttributes,
  rowIdSegment,
} from "@agent-native/design-system/model";
import {
  combineFragments,
  type ModelFragment,
  ModelSurface,
} from "@agent-native/toolkit/design-system";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@agent-native/toolkit/ui/empty";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import {
  IconDots,
  IconLock,
  IconKey,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  SENTENCE_LINK_TOKEN,
  SentenceWithLink,
  SettingsPageLink,
} from "../../integrations/index.js";
import { ReadOnlySettingValue } from "../app-group/ReadOnlySettingValue.js";
import { ProviderDialog } from "../model/ProviderDialog.js";
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
  KeyOriginsDialog,
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
  const [editingOrigins, setEditingOrigins] = useState<ApiKeyEntry | null>(
    null,
  );
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
          disabled={!ready}
          onClick={() => setValueDialog({ mode: "add" })}
        >
          <IconPlus aria-hidden />
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
          variant="outline"
          size="sm"
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
    onEditOrigins: setEditingOrigins,
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-8" data-api-keys-settings="">
        <div>
          <KeysSurface
            group={keyGroup(
              "your-keys",
              t(`${K}yourKeys`),
              groups.personal.length > 0
                ? groups.personal.map((entry) =>
                    keyRow("your-keys", entry, t, rowProps),
                  )
                : [
                    {
                      rows: [
                        {
                          id: "settings.api-keys.your-keys.empty",
                          part: "settings.content",
                          label: t(`${K}noKeys`),
                          slot: "your-keys-empty",
                        },
                      ],
                      slots: {
                        "your-keys-empty": (row: ModelRow) => (
                          <Empty {...rowAttributes(row)} data-api-keys-empty="">
                            <EmptyHeader>
                              <EmptyMedia variant="icon">
                                <IconKey aria-hidden />
                              </EmptyMedia>
                              <EmptyTitle>{t(`${K}noKeys`)}</EmptyTitle>
                              <EmptyDescription>
                                {t(`${K}noKeysDescription`)}
                              </EmptyDescription>
                            </EmptyHeader>
                            <EmptyContent>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => setValueDialog({ mode: "add" })}
                              >
                                <IconPlus aria-hidden />
                                {t(`${K}addKey`)}
                              </Button>
                            </EmptyContent>
                          </Empty>
                        ),
                      },
                    },
                  ],
            )}
          />
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
          <KeysSurface
            group={keyGroup(
              "org-keys",
              t(`${K}orgKeys`),
              groups.org.map((entry) => keyRow("org-keys", entry, t, rowProps)),
            )}
          />
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
      {editingOrigins ? (
        <KeyOriginsDialog
          entry={editingOrigins}
          open
          onOpenChange={(open) => {
            if (!open) setEditingOrigins(null);
          }}
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

type Translate = ReturnType<typeof useT>;

interface KeyRowHandlers {
  onManageProvider: (entry: ApiKeyEntry) => void;
  onReplace: (entry: ApiKeyEntry) => void;
  onDelete: (entry: ApiKeyEntry) => void;
  onEditOrigins: (entry: ApiKeyEntry) => void;
}

function keyGroup(
  group: string,
  label: string,
  fragments: readonly ModelFragment[],
): ModelFragment {
  const combined = combineFragments(fragments);
  return {
    rows: [
      {
        id: `settings.api-keys.${group}`,
        part: "settings.group",
        label,
        anchor: group,
        rows: combined.rows,
      },
    ],
    actions: combined.actions,
    slots: combined.slots,
  };
}

function KeysSurface({ group }: { group: ModelFragment }) {
  return (
    <ModelSurface
      model={{ id: "settings", rows: group.rows }}
      actions={group.actions}
      slots={group.slots}
    />
  );
}

function keyRow(
  group: string,
  entry: ApiKeyEntry,
  t: Translate,
  { onManageProvider, onReplace, onDelete, onEditOrigins }: KeyRowHandlers,
): ModelFragment {
  const id = `settings.api-keys.${group}.${rowIdSegment(apiKeyEntryId(entry))}`;
  const hasUse = !!entry.provider || usedByFeatures(entry).length > 0;
  const custom = !entry.registered && !entry.provider;
  const slots: Record<string, ReactNode> = {};
  const regions: Record<string, string> = {};
  if (entry.label === undefined) {
    regions.label = `${id}:label`;
    slots[regions.label] = (
      <span className="font-mono text-[13px]">{entry.name}</span>
    );
  } else if (entry.label === "") {
    regions.label = `${id}:label`;
    slots[regions.label] = entry.label;
  }
  if (entry.masked || hasUse || (custom && entry.canEditOrigins)) {
    regions.description = `${id}:description`;
    slots[regions.description] = (
      <>
        {entry.masked ? (
          <span className="font-mono">{entry.masked}</span>
        ) : null}
        {entry.masked && hasUse ? " · " : null}
        {hasUse ? <UsedBy entry={entry} /> : null}
        {custom && entry.canEditOrigins && (entry.masked || hasUse)
          ? " · "
          : null}
        {custom && entry.canEditOrigins
          ? entry.urlAllowlist?.length
            ? t(`${K}originsCount`, { count: entry.urlAllowlist.length })
            : t(`${K}noApprovedOrigins`)
          : null}
      </>
    );
  }

  let slot: string | undefined;
  let rows: ModelRow[] | undefined;
  const actions: Record<string, () => void> = {};
  if (entry.vault) {
    slot = `${id}:control`;
    slots[slot] = (
      <ReadOnlySettingValue
        value={t("secrets.sourceVault")}
        reason={t("secrets.managedInVault")}
      />
    );
  } else if (entry.provider && entry.canDelete) {
    rows = [
      {
        id: `${id}.manage`,
        part: "button",
        kind: "action",
        label: t(`${M}manage`),
        effect: { kind: "action", effectId: `${id}.manage` },
      },
    ];
    actions[`${id}.manage`] = () => onManageProvider(entry);
  } else if (entry.canReplace || entry.canDelete) {
    slot = `${id}:control`;
    slots[slot] = (
      <KeyMenu
        entry={entry}
        onReplace={() => onReplace(entry)}
        onDelete={() => onDelete(entry)}
        onEditOrigins={() => onEditOrigins(entry)}
      />
    );
  }

  return {
    rows: [
      {
        id,
        part: "settings.row",
        label: entry.label || entry.name,
        anchor: apiKeyRowId(entry),
        ...(Object.keys(regions).length > 0 ? { regions } : {}),
        ...(slot ? { slot } : {}),
        ...(rows ? { rows } : {}),
      },
    ],
    actions,
    slots,
  };
}

function KeyMenu({
  entry,
  onReplace,
  onDelete,
  onEditOrigins,
}: {
  entry: ApiKeyEntry;
  onReplace: () => void;
  onDelete: () => void;
  onEditOrigins: () => void;
}) {
  const t = useT();
  const test = async () => {
    const result = await testSavedApiKey(entry.name);
    if (result.ok) {
      toast.success(t(`${K}testPassed`));
    } else toast.error(result.error);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t(`${K}manageKey`, { name: entry.name })}
        >
          <IconDots aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {entry.canEditOrigins ? (
          <DropdownMenuItem onSelect={onEditOrigins}>
            <IconLock className="size-4" aria-hidden />
            {t(`${K}editOrigins`)}
          </DropdownMenuItem>
        ) : null}
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
  const slots: Record<string, ReactNode | ((row: ModelRow) => ReactNode)> = {};
  const rows: ModelRow[] = open
    ? entries.map((entry): ModelRow => {
        const owner = entry.managedBy;
        if (!owner) {
          throw new Error(`Managed key ${entry.name} has no managing owner`);
        }
        const { page, sub } = settingsRouteParts(owner.route);
        const id = `settings.api-keys.managed-keys.${rowIdSegment(apiKeyEntryId(entry))}`;
        slots[`${id}:label`] = (
          <span className="break-all font-mono text-[13px]">{entry.name}</span>
        );
        slots[`${id}:description`] = (
          <SentenceWithLink
            text={t(`${K}usedBy`, { link: SENTENCE_LINK_TOKEN })}
            link={
              <SettingsPageLink page={page} sub={sub}>
                {owner.owner}
              </SettingsPageLink>
            }
          />
        );
        slots[`${id}:control`] = (
          <ReadOnlySettingValue
            value={
              entry.scope === "org" && orgName
                ? orgName
                : t(entry.scope === "org" ? `${M}organization` : `${M}personal`)
            }
            reason={t(`${K}managedTooltip`, { owner: owner.owner })}
          />
        );
        return {
          id,
          part: "settings.row",
          label: entry.name,
          anchor: apiKeyRowId(entry),
          regions: {
            label: `${id}:label`,
            description: `${id}:description`,
          },
          slot: `${id}:control`,
        };
      })
    : [];
  const toggleLabel = open
    ? t(`${K}hideKeys`)
    : t(`${K}showKeys`, { count: entries.length });
  rows.push({
    id: "settings.api-keys.managed-keys.toggle",
    part: "settings.content",
    label: toggleLabel,
    slot: "managed-keys-toggle",
  });
  slots["managed-keys-toggle"] = (row) => (
    <div
      {...rowAttributes(row)}
      className="flex justify-center px-5 py-2 sm:px-6"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {toggleLabel}
      </Button>
    </div>
  );
  return (
    <ModelSurface
      model={{
        id: "settings",
        rows: [
          {
            id: "settings.api-keys.managed-keys",
            part: "settings.group",
            label: t(`${K}managedKeys`),
            anchor: "managed-keys",
            rows,
          },
        ],
      }}
      slots={slots}
    />
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
