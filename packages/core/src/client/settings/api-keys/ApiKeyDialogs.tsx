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
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import {
  IconAlertCircle,
  IconExternalLink,
  IconLock,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import type { SecretRemovalPreview } from "../../../secrets/usage.js";
import { getAgentProviderOption } from "../../agent-provider-catalog.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { useT } from "../../i18n.js";
import {
  SENTENCE_LINK_TOKEN,
  SentenceWithLink,
  SettingsPageLink,
} from "../../integrations/settings-page-link.js";
import { useOrg } from "../../org/hooks.js";
import { callAction, useActionQuery } from "../../use-action.js";
import { effectText } from "../model/RemoveProviderDialog.js";
import { normalizeKeyName } from "../NewKeyMenu.js";
import { saveApiKeyValue, notifyKeysChanged } from "./api-keys-client.js";
import {
  addableSuggestions,
  addKeyTarget,
  type ApiKeyEntry,
  type ApiKeysListing,
} from "./api-keys-state.js";

const K = "agentChat.settingsApiKeys.";
const M = "agentChat.settingsModel.";

function refreshKeys(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient.invalidateQueries({ queryKey: ["action"] });
}

export type KeyValueDialogMode =
  /**
   * `forService`: a service's organization key (Infrastructure). The name is
   * fixed and the key is saved for everyone in the organization.
   */
  | { mode: "add"; initialName?: string; forService?: boolean }
  | { mode: "replace"; entry: ApiKeyEntry };

export interface KeyValueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dialog: KeyValueDialogMode;
  listing: ApiKeysListing;
  orgName: string;
  /** Called after the value is saved, before the dialog closes. */
  onSaved?: () => void;
}

/** Add key (Name, Value, Available to), or Replace value on a saved key. */
export function KeyValueDialog(props: KeyValueDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <KeyValueDialogContent {...props} /> : null}
    </Dialog>
  );
}

/** False once the dialog content unmounts, so a late save can't close a newer dialog. */
function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <IconAlertCircle aria-hidden />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function KeyValueDialogContent({
  onOpenChange,
  dialog,
  listing,
  orgName,
  onSaved,
}: KeyValueDialogProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const mounted = useMounted();
  const ids = {
    name: useId(),
    nameHint: useId(),
    value: useId(),
    who: useId(),
  };
  const replacing = dialog.mode === "replace" ? dialog.entry : null;
  const forService = dialog.mode === "add" && dialog.forService === true;
  const [name, setName] = useState(
    replacing?.name ??
      (dialog.mode === "add" ? (dialog.initialName ?? "") : ""),
  );
  const [value, setValue] = useState("");
  const [shared, setShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = replacing
    ? replacing.registered
      ? ({
          kind: "registered",
          key: {
            name: replacing.name,
            label: replacing.label ?? replacing.name,
            ...(replacing.docsUrl ? { docsUrl: replacing.docsUrl } : {}),
            scope: replacing.storedScope,
          },
        } as const)
      : ({ kind: "custom", name: replacing.name } as const)
    : addKeyTarget(name, listing);
  const suggestions =
    replacing || forService ? [] : addableSuggestions(name, listing);
  const blocked = target.kind === "provider" || target.kind === "managed";

  // Registered keys save at their registered scope, which the server
  // enforces, so they show it; a service's other keys are the organization's.
  // Only an ad-hoc key's owner or admin chooses. Replacing keeps the row
  // where it is.
  const lockedShared = replacing
    ? replacing.storedScope !== "user"
    : target.kind === "registered"
      ? target.key.scope !== "user"
      : forService
        ? true
        : null;
  const canChoose =
    lockedShared === null && listing.hasOrganization && listing.canManageOrg;
  const isShared = lockedShared ?? (canChoose && shared);
  const valid = !blocked && target.kind !== "empty" && !!value.trim();

  const save = async () => {
    if (saving || !valid) return;
    setSaving(true);
    setError(null);
    try {
      await saveApiKeyValue({
        name: target.kind === "registered" ? target.key.name : target.name,
        value: value.trim(),
        registered: target.kind === "registered",
        shared: isShared,
      });
      void refreshKeys(queryClient);
      toast.success(replacing ? t(`${K}valueReplaced`) : t(`${K}keyAdded`));
      onSaved?.();
      if (mounted.current) onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const docsUrl = target.kind === "registered" ? target.key.docsUrl : undefined;
  const whoValue = isShared
    ? t(`${K}everyoneIn`, { org: orgName })
    : t(`${K}justMe`);

  return (
    <DialogContent
      className="max-w-lg"
      closeLabel={t("agentChat.settingsInfra.close")}
      aria-describedby={undefined}
    >
      <DialogHeader>
        <DialogTitle>
          {replacing
            ? t(`${K}replaceTitle`, { name: replacing.name })
            : t(`${K}addKey`)}
        </DialogTitle>
      </DialogHeader>
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {replacing ? null : (
          <div className="grid gap-2">
            <Label htmlFor={ids.name}>{t(`${K}name`)}</Label>
            <Input
              id={ids.name}
              value={name}
              autoFocus={!forService}
              readOnly={forService}
              autoComplete="off"
              spellCheck={false}
              placeholder="STRIPE_SECRET_KEY"
              aria-invalid={blocked || undefined}
              aria-describedby={
                target.kind === "provider" ||
                target.kind === "managed" ||
                target.kind === "registered"
                  ? ids.nameHint
                  : undefined
              }
              onChange={(event) => {
                setName(normalizeKeyName(event.target.value));
                setError(null);
              }}
            />
            {suggestions.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((key) => (
                  <Button
                    key={key.name}
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={() => setName(key.name)}
                  >
                    <span className="font-mono">{key.name}</span>
                  </Button>
                ))}
              </div>
            ) : null}
            <NameHint id={ids.nameHint} target={target} />
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor={ids.value}>{t(`${K}value`)}</Label>
          <Input
            id={ids.value}
            type="password"
            value={value}
            autoFocus={!!replacing || forService}
            autoComplete="off"
            disabled={blocked}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
          />
          {docsUrl ? (
            <a
              href={docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {t(`${K}getKey`)}
              <IconExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : null}
        </div>
        {listing.hasOrganization && !blocked ? (
          <div className="grid gap-2">
            <span
              id={ids.who}
              className="text-sm font-medium leading-none text-foreground"
            >
              {t(`${K}availableTo`)}
            </span>
            {canChoose ? (
              <Select
                value={shared ? "org" : "user"}
                onValueChange={(next) => setShared(next === "org")}
              >
                <SelectTrigger aria-labelledby={ids.who}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">{t(`${K}justMe`)}</SelectItem>
                  <SelectItem value="org">
                    {t(`${K}everyoneIn`, { org: orgName })}
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div
                aria-labelledby={ids.who}
                className="flex h-9 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground"
              >
                <IconLock className="size-4 shrink-0" aria-hidden />
                <span>{whoValue}</span>
              </div>
            )}
            {lockedShared === null && !listing.canManageOrg ? (
              <p className="text-xs leading-5 text-muted-foreground">
                {t(`${K}membersLocked`, { org: orgName })}
              </p>
            ) : null}
          </div>
        ) : null}
        <FormError message={error} />
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            {t(`${M}cancel`)}
          </Button>
          <Button type="submit" disabled={saving || !valid}>
            {saving ? <Spinner aria-hidden /> : null}
            {replacing
              ? saving
                ? t(`${K}saving`)
                : t(`${M}save`)
              : saving
                ? t(`${K}adding`)
                : t(`${K}addKey`)}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

export interface ServiceKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The API key the service reads, e.g. `VOYAGE_API_KEY`. */
  keyName: string;
  /** `add` a new organization key, or `manage` (replace) the saved one. */
  mode: "add" | "manage";
  onSaved?: () => void;
}

/**
 * Add key or Replace value for a service's organization key, opened in place
 * from Infrastructure. Reads the listing the dialog needs itself.
 */
export function ServiceKeyDialog(props: ServiceKeyDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && props.keyName ? (
        <ServiceKeyDialogContent {...props} />
      ) : null}
    </Dialog>
  );
}

function ServiceKeyDialogContent({
  onOpenChange,
  keyName,
  mode,
  onSaved,
}: ServiceKeyDialogProps) {
  const t = useT();
  const org = useOrg();
  const listing = useActionQuery<ApiKeysListing>("list-api-keys" as never);

  if (listing.data && !org.isLoading) {
    const saved =
      mode === "manage"
        ? listing.data.keys.find(
            (entry) => entry.name === keyName && entry.scope === "org",
          )
        : undefined;
    return (
      <KeyValueDialogContent
        open
        onOpenChange={onOpenChange}
        dialog={
          saved
            ? { mode: "replace", entry: saved }
            : { mode: "add", initialName: keyName, forService: true }
        }
        listing={listing.data}
        orgName={org.data?.orgName ?? ""}
        {...(onSaved ? { onSaved } : {})}
      />
    );
  }

  return (
    <DialogContent
      className="max-w-lg"
      closeLabel={t("agentChat.settingsInfra.close")}
      aria-describedby={undefined}
    >
      <DialogHeader>
        <DialogTitle>
          {mode === "manage"
            ? t(`${K}replaceTitle`, { name: keyName })
            : t(`${K}addKey`)}
        </DialogTitle>
      </DialogHeader>
      {listing.isError ? (
        <div className="flex items-center justify-between gap-4">
          <p role="alert" className="text-sm text-destructive">
            {t(`${K}loadFailed`)}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void listing.refetch()}
          >
            {t(`${M}retry`)}
          </Button>
        </div>
      ) : (
        <div
          className="grid gap-5"
          aria-busy="true"
          aria-label={t("agentChat.settingsShell.loading")}
        >
          {/* Add has Name, Value, and Available to; Replace drops Name. */}
          {(mode === "manage" ? [0, 1] : [0, 1, 2]).map((index) => (
            <div key={index} className="grid gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      )}
      <DialogFooter className="gap-2 sm:space-x-0">
        <Button
          type="button"
          variant="secondary"
          onClick={() => onOpenChange(false)}
        >
          {t(`${M}cancel`)}
        </Button>
        <Button type="button" disabled>
          {mode === "manage" ? t(`${M}save`) : t(`${K}addKey`)}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function NameHint({
  id,
  target,
}: {
  id: string;
  target: ReturnType<typeof addKeyTarget>;
}) {
  const t = useT();
  if (target.kind === "provider") {
    return (
      <p id={id} className="text-xs leading-5 text-destructive">
        <SentenceWithLink
          text={t(`${K}providerInModel`, {
            provider: getAgentProviderOption(target.provider).label,
            link: SENTENCE_LINK_TOKEN,
          })}
          link={
            <SettingsPageLink page="model">
              {t("agentChat.settingsShell.page.model")}
            </SettingsPageLink>
          }
        />
      </p>
    );
  }
  if (target.kind === "managed") {
    return (
      <p id={id} className="text-xs leading-5 text-destructive">
        {t(`${K}managedName`, { owner: target.owner })}
      </p>
    );
  }
  if (target.kind === "registered") {
    return (
      <p id={id} className="text-xs leading-5 text-muted-foreground">
        {target.key.label}
      </p>
    );
  }
  return null;
}

export interface DeleteKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: ApiKeyEntry;
  orgName: string;
}

/**
 * "Delete {key}?" with who it affects and what stops, per app and feature,
 * from `preview-secret-removal`, then `delete-api-key`.
 */
export function DeleteKeyDialog(props: DeleteKeyDialogProps) {
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <DeleteKeyContent {...props} /> : null}
    </AlertDialog>
  );
}

function DeleteKeyContent({
  onOpenChange,
  entry,
  orgName,
}: DeleteKeyDialogProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const preview = useActionQuery<SecretRemovalPreview>(
    "preview-secret-removal" as never,
    { key: entry.name, scope: entry.storedScope } as never,
  );
  const mounted = useMounted();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await callAction(
        "delete-api-key" as never,
        {
          name: entry.name,
          scope: entry.scope,
          storedScope: entry.storedScope,
        } as never,
      );
      notifyKeysChanged();
      void refreshKeys(queryClient);
      toast.success(t(`${K}keyDeleted`));
      if (mounted.current) onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const appName = (app: string) => {
    if (app === "all") return t(`${M}allApps`);
    const other =
      preview.data?.otherApps.status === "listed"
        ? preview.data.otherApps.apps.find((item) => item.id === app)
        : undefined;
    return other?.name ?? app;
  };

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {t(`${K}deleteTitle`, { name: entry.name })}
        </AlertDialogTitle>
      </AlertDialogHeader>
      <div className="grid gap-4 text-sm">
        <AlertDialogDescription>
          {entry.scope === "org"
            ? t(`${M}affectsOrg`, { org: orgName })
            : t(`${M}affectsYou`)}
        </AlertDialogDescription>
        <div className="grid gap-2">
          <p className="font-medium">{t(`${M}whatHappens`)}</p>
          <div className="overflow-hidden rounded-lg border border-border/70">
            {preview.isError ? (
              <p className="px-4 py-3 text-muted-foreground">
                {t(`${M}previewFailed`)}
              </p>
            ) : !preview.data ? (
              <div
                className="grid gap-2 px-4 py-3"
                aria-busy="true"
                aria-label={t("agentChat.settingsShell.loading")}
              >
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : preview.data.effects.length === 0 ? (
              <p className="px-4 py-3 text-muted-foreground">
                {t(`${M}nothingElse`)}
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {preview.data.effects.map((effect, index) => (
                  <li key={index} className="grid gap-0.5 px-4 py-3">
                    <span className="font-medium">
                      {effect.feature}{" "}
                      <span className="font-normal text-muted-foreground">
                        {appName(effect.app)}
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      {effectText(t, effect)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <FormError message={error} />
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel asChild disabled={deleting}>
          <Button type="button" variant="secondary">
            {t(`${M}cancel`)}
          </Button>
        </AlertDialogCancel>
        <Button
          type="button"
          variant="destructive"
          disabled={deleting}
          onClick={() => void remove()}
        >
          {deleting ? <Spinner aria-hidden /> : null}
          {deleting ? t(`${K}deleting`) : t(`${K}deleteKey`)}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}
