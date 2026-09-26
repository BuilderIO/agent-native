import { Alert, AlertDescription } from "@agent-native/toolkit/ui/alert";
import { Button } from "@agent-native/toolkit/ui/button";
import { Checkbox } from "@agent-native/toolkit/ui/checkbox";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@agent-native/toolkit/ui/radio-group";
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
  IconKey,
  IconLock,
  IconServer,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  fetchProviderModels,
  saveAgentEngineProviderSettings,
  type AgentEngineKeyScope,
  type ProviderModelsCheck,
} from "../../agent-engine-key.js";
import {
  getAgentProviderOption,
  type AgentProviderId,
} from "../../agent-provider-catalog.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { useFormatters, useT } from "../../i18n.js";
import { useOrg } from "../../org/hooks.js";
import { callAction, useActionQuery } from "../../use-action.js";
import { cn } from "../../utils.js";
import { BrandLogo } from "../infra/logos.js";
import {
  addDialogChoices,
  explicitSelectionAt,
  keyConsoleHost,
  providerLabel,
  recommendedModels,
  selectedModelsAt,
  type ModelProviderKey,
  type ModelProvidersListing,
  type ProviderModelsRead,
} from "./model-page-state.js";
import { RemoveProviderDialog } from "./RemoveProviderDialog.js";

const K = "agentChat.settingsModel.";
const CHECK_DEBOUNCE_MS = 400;
const OLLAMA_PLACEHOLDER = "http://localhost:11434";
const GATEWAY_PLACEHOLDER = "https://gateway.example/v1";

/** Each provider's mark in the integration logo set; Ollama has none. */
const PROVIDER_LOGO_IDS: Record<AgentProviderId, string | null> = {
  anthropic: "anthropic",
  openai: "openai",
  openrouter: "openrouter",
  google: "google-gemini",
  groq: "groq",
  mistral: "mistral",
  cohere: "cohere",
  ollama: null,
};

/**
 * `add` offers the providers the viewer hasn't added, plus ones with a
 * rejected key to replace (chat recovery opens it after a rejection). `manage` edits one
 * saved key. `add-from-service` adds a fixed provider's organization key for a
 * service (Infrastructure), with chat models left unchecked.
 */
export type ProviderDialogMode = "add" | "manage" | "add-from-service";

export interface ProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ProviderDialogMode;
  /** Required for `manage` and `add-from-service`; the first choice for `add`. */
  provider?: AgentProviderId;
  /** `manage`: which saved key, the personal (`user`) or organization (`org`) one. */
  scope?: AgentEngineKeyScope;
  /** `add-from-service`: the service that uses the key, e.g. "voice input". */
  serviceLabel?: string;
  /** `add`: limit the choice to these of the providers `add` offers. */
  providers?: readonly AgentProviderId[];
  onSaved?: (result: {
    provider: AgentProviderId;
    scope: AgentEngineKeyScope;
  }) => void;
  onRemoved?: (result: {
    provider: AgentProviderId;
    scope: AgentEngineKeyScope;
  }) => void;
}

type CheckState =
  | { state: "idle" }
  | { state: "checking" }
  | (Extract<ProviderModelsCheck, { ok: true }> & { state: "ok" })
  | (Extract<ProviderModelsCheck, { ok: false }> & { state: "failed" })
  | { state: "error"; message: string };

function toCheckState(result: ProviderModelsCheck): CheckState {
  return result.ok
    ? { ...result, state: "ok" }
    : { ...result, state: "failed" };
}

function sameModels(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((model) => set.has(model));
}

function unique(models: readonly string[]): string[] {
  return [...new Set(models)];
}

/**
 * The one writer for a model provider's key: Settings › Model, API keys,
 * Infrastructure services, and chat recovery all open this dialog. Pasting a
 * key checks it by listing the models it reaches, and Save stores the key and
 * the checked models in one step.
 */
export function ProviderDialog(props: ProviderDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <ProviderDialogContent {...props} /> : null}
    </Dialog>
  );
}

function ProviderDialogContent(props: ProviderDialogProps) {
  const t = useT();
  const listing = useActionQuery<ModelProvidersListing>(
    "list-model-providers" as never,
  );
  const models = useActionQuery<ProviderModelsRead>(
    "get-provider-models" as never,
  );
  const fixedName = props.provider ? providerLabel(props.provider) : null;
  const title =
    props.mode === "manage" && fixedName
      ? fixedName
      : props.mode === "add-from-service" && fixedName
        ? t(`${K}addNamed`, { provider: fixedName })
        : t(`${K}addProvider`);

  if (listing.data && models.data) {
    return (
      <ProviderDialogForm
        {...props}
        title={title}
        listing={listing.data}
        models={models.data}
      />
    );
  }

  const failed = listing.isError || models.isError;
  return (
    <DialogContent
      className="max-w-lg"
      closeLabel={t("agentChat.settingsInfra.close")}
      aria-describedby={undefined}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      {failed ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm">
          <p className="text-destructive">{t(`${K}loadFailed`)}</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              void listing.refetch();
              void models.refetch();
            }}
          >
            {t("agentChat.common.retry")}
          </Button>
        </div>
      ) : (
        <div
          className="grid gap-4"
          aria-busy="true"
          aria-label={t("agentChat.settingsShell.loading")}
        >
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}
    </DialogContent>
  );
}

interface FormProps extends ProviderDialogProps {
  title: string;
  listing: ModelProvidersListing;
  models: ProviderModelsRead;
}

function ProviderDialogForm({
  mode,
  provider: requestedProvider,
  scope: requestedScope,
  serviceLabel,
  providers: providerChoices,
  onOpenChange,
  onSaved,
  onRemoved,
  title,
  listing,
  models,
}: FormProps) {
  const t = useT();
  const formatters = useFormatters();
  const queryClient = useQueryClient();
  const org = useOrg();
  const orgName = org.data?.orgName ?? "";
  const ids = {
    provider: useId(),
    key: useId(),
    endpoint: useId(),
    who: useId(),
    models: useId(),
  };
  const keyInputRef = useRef<HTMLInputElement>(null);

  const restricted = mode === "add" && listing.personalKeysRestricted;
  // Add mode only. Nothing here is offered as new when it already has a key:
  // a provider with a saved key is a replace of that key, at its scope.
  const addChoices = useMemo(
    () => (mode === "add" ? addDialogChoices(listing, providerChoices) : []),
    [listing, mode, providerChoices],
  );
  const choices = addChoices.map((choice) => choice.provider);
  const [provider, setProvider] = useState<AgentProviderId>(
    () =>
      (mode === "add" &&
      requestedProvider &&
      !choices.includes(requestedProvider)
        ? choices[0]
        : requestedProvider) ??
      choices[0] ??
      "anthropic",
  );
  const option = getAgentProviderOption(provider);
  const name = option.label;
  const isOllama = provider === "ollama";
  const isOpenAi = provider === "openai";
  const replaceTarget =
    addChoices.find((choice) => choice.provider === provider)?.replaces ?? null;

  const whoChoice = listing.hasOrganization && listing.canManageOrg;
  const [chosenScope, setScope] = useState<AgentEngineKeyScope>(() => {
    if (mode === "manage") return requestedScope ?? "user";
    if (mode === "add-from-service") return "org";
    return whoChoice ? "org" : "user";
  });
  const scope = replaceTarget?.scope ?? chosenScope;

  const entry = listing.providers.find((item) => item.provider === provider);
  const existing: ModelProviderKey | null =
    mode === "manage"
      ? ((scope === "org" ? entry?.org : entry?.personal) ?? null)
      : replaceTarget;

  const [replacing, setReplacing] = useState(
    () => mode !== "manage" || !existing || !!existing.rejectedAt,
  );
  const [keyValue, setKeyValue] = useState("");
  const [keyError, setKeyError] = useState(false);
  const savedEndpoint = isOpenAi ? (existing?.endpoint ?? "") : "";
  const [endpointOpen, setEndpointOpen] = useState(!!savedEndpoint);
  const [endpoint, setEndpoint] = useState(savedEndpoint);

  // What this open started with; Save writes the selection only if it changed.
  const [initialSelection] = useState<string[]>(() =>
    mode === "manage" ? (selectedModelsAt(models, provider, scope) ?? []) : [],
  );
  // A replaced key keeps the models checked for it, where the new key reaches them.
  const [checked, setChecked] = useState<string[]>(() =>
    replaceTarget
      ? (explicitSelectionAt(models, provider, replaceTarget.scope) ?? [])
      : initialSelection,
  );
  const [check, setCheck] = useState<CheckState>({ state: "idle" });
  const [recheck, setRecheck] = useState<
    "idle" | "checking" | { checkedAt: number }
  >("idle");
  const [savedRejected, setSavedRejected] = useState(
    () => !!existing?.rejectedAt,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const requestRef = useRef(0);
  const fromService = mode === "add-from-service";

  // A pasted key (or Ollama endpoint) is checked as it's entered, by asking
  // the provider which models it reaches.
  useEffect(() => {
    if (!replacing) return;
    const value = keyValue.trim();
    const request = ++requestRef.current;
    if (!value) {
      setCheck({ state: "idle" });
      return;
    }
    setCheck({ state: "checking" });
    const gateway =
      provider === "openai" && endpointOpen ? endpoint.trim() : "";
    const recommended = recommendedModels(models, provider);
    const timer = window.setTimeout(() => {
      fetchProviderModels(
        provider === "ollama"
          ? { provider, baseUrl: value }
          : { provider, key: value, ...(gateway ? { baseUrl: gateway } : {}) },
      )
        .then((result) => {
          if (request !== requestRef.current) return;
          setCheck(toCheckState(result));
          if (!result.ok) return;
          setChecked((previous) => {
            const kept = previous.filter((model) =>
              result.models.includes(model),
            );
            if (kept.length > 0 || fromService) return kept;
            return result.models.filter((model) => recommended.includes(model));
          });
        })
        .catch((err: unknown) => {
          if (request !== requestRef.current) return;
          setCheck({
            state: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        });
    }, CHECK_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    provider,
    keyValue,
    endpoint,
    endpointOpen,
    replacing,
    models,
    fromService,
  ]);

  // Models checked when the dialog opened stay listed after a check, so one
  // the key no longer reaches can still be unchecked. Before a check, a saved
  // selection lists only itself: the recommended names (Ollama's especially)
  // aren't necessarily models this key reaches.
  const available =
    check.state === "ok"
      ? unique([...check.models, ...initialSelection])
      : replacing
        ? []
        : explicitSelectionAt(models, provider, scope) !== null
          ? initialSelection
          : unique([
              ...recommendedModels(models, provider),
              ...initialSelection,
            ]);
  const listReady = check.state === "ok" || !replacing;
  const allChecked =
    available.length > 0 && available.every((model) => checked.includes(model));

  const chooseProvider = (next: AgentProviderId) => {
    if (next === provider) return;
    // A pasted key is checked again under the new provider, so a key pasted
    // under the wrong one says whose it looks like.
    const keepValue = (next === "ollama") === isOllama;
    const target =
      addChoices.find((choice) => choice.provider === next)?.replaces ?? null;
    const nextEndpoint = next === "openai" ? (target?.endpoint ?? "") : "";
    setProvider(next);
    setKeyValue((value) => (keepValue ? value : ""));
    setKeyError(false);
    setChecked(
      target ? (explicitSelectionAt(models, next, target.scope) ?? []) : [],
    );
    setEndpoint(nextEndpoint);
    setEndpointOpen(!!nextEndpoint);
    setSavedRejected(!!target?.rejectedAt);
    setError(null);
  };

  const runRecheck = () => {
    setRecheck("checking");
    setError(null);
    fetchProviderModels({ provider, scope })
      .then((result) => {
        if (result.ok) {
          setCheck(toCheckState(result));
          setRecheck({ checkedAt: result.checkedAt });
          return;
        }
        setRecheck("idle");
        setCheck(toCheckState(result));
        if (result.code === "rejected" || result.code === "wrong-provider") {
          setSavedRejected(true);
          setReplacing(true);
          window.requestAnimationFrame(() => keyInputRef.current?.focus());
        }
        void queryClient.invalidateQueries({ queryKey: ["action"] });
      })
      .catch((err: unknown) => {
        setRecheck("idle");
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  const save = async () => {
    if (saving) return;
    setError(null);
    const value = keyValue.trim();
    if (replacing && !value) {
      setKeyError(true);
      keyInputRef.current?.focus();
      return;
    }
    if (replacing && check.state !== "ok") {
      keyInputRef.current?.focus();
      return;
    }
    const gateway = isOpenAi && endpointOpen ? endpoint.trim() : "";
    const endpointChanged = isOpenAi && gateway !== (existing?.endpoint ?? "");
    const modelsChanged =
      mode !== "manage" || !sameModels(checked, initialSelection ?? []);

    setSaving(true);
    let keySaved = false;
    try {
      if (replacing) {
        await saveAgentEngineProviderSettings({
          provider,
          ...(isOllama ? { baseUrl: value } : { apiKey: value }),
          ...(gateway ? { baseUrl: gateway } : {}),
          ...(isOpenAi && !gateway && existing?.endpoint
            ? { clearBaseUrl: true }
            : {}),
          scope,
        });
        keySaved = true;
      } else if (endpointChanged) {
        await saveAgentEngineProviderSettings({
          provider,
          ...(gateway ? { baseUrl: gateway } : { clearBaseUrl: true }),
          scope,
        });
        keySaved = true;
      }
      if (modelsChanged) {
        await callAction(
          "manage-provider-models" as never,
          {
            action: "set",
            provider,
            scope,
            models: checked,
          } as never,
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["action"] });
      onSaved?.({ provider, scope });
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(keySaved ? t(`${K}modelsSaveFailed`, { message }) : message);
      if (keySaved) {
        void queryClient.invalidateQueries({ queryKey: ["action"] });
      }
    } finally {
      setSaving(false);
    }
  };

  if (restricted) {
    return (
      <DialogContent
        className="max-w-lg"
        closeLabel={t("agentChat.settingsInfra.close")}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <IconLock className="size-4 shrink-0" aria-hidden />
          {t(`${K}restricted`)}
        </p>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            {t(`${K}cancel`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  // Save needs a key the provider accepted; a saved key needs no new check.
  const ready = !replacing || check.state === "ok";
  const addsNew = mode !== "manage" && !replaceTarget;
  const primaryLabel = saving
    ? addsNew
      ? t(`${K}adding`)
      : t(`${K}saving`)
    : mode === "manage"
      ? t(`${K}save`)
      : fromService
        ? t(`${K}addNamed`, { provider: name })
        : replaceTarget
          ? t(`${K}replaceKey`)
          : t(`${K}addProvider`);

  return (
    <DialogContent
      className="max-w-lg"
      closeLabel={t("agentChat.settingsInfra.close")}
      aria-describedby={undefined}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {mode === "add" ? (
          <div className="grid gap-2">
            <Label htmlFor={ids.provider}>{t(`${K}provider`)}</Label>
            <Select
              value={provider}
              onValueChange={(value) =>
                chooseProvider(value as AgentProviderId)
              }
              disabled={saving}
            >
              <SelectTrigger id={ids.provider} autoFocus>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {choices.map((id) => (
                  <SelectItem key={id} value={id}>
                    <span className="flex items-center gap-2">
                      <BrandLogo
                        logoId={PROVIDER_LOGO_IDS[id]}
                        fallback={IconServer}
                        size="sm"
                      />
                      {providerLabel(id)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="grid gap-2">
          <Label htmlFor={ids.key}>
            {isOllama ? t(`${K}endpointUrl`) : t(`${K}apiKey`)}
          </Label>
          {replacing ? (
            <Input
              ref={keyInputRef}
              id={ids.key}
              type={isOllama ? "url" : "password"}
              value={keyValue}
              autoComplete="off"
              spellCheck={false}
              autoFocus={mode !== "add"}
              disabled={saving}
              placeholder={
                isOllama
                  ? OLLAMA_PLACEHOLDER
                  : t(`${K}keyPlaceholder`, { provider: name })
              }
              aria-invalid={keyError || check.state === "failed"}
              aria-describedby={`${ids.key}-hint`}
              onChange={(event) => {
                setKeyValue(event.target.value);
                setKeyError(false);
              }}
            />
          ) : (
            <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-background ps-3 pe-1.5">
              <span className="truncate font-mono text-sm">
                {isOllama ? existing?.endpoint : existing?.masked}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="xs"
                disabled={saving}
                onClick={() => {
                  setReplacing(true);
                  window.requestAnimationFrame(() =>
                    keyInputRef.current?.focus(),
                  );
                }}
              >
                {isOllama ? t(`${K}change`) : t(`${K}replace`)}
              </Button>
            </div>
          )}
          <KeyHint
            id={`${ids.key}-hint`}
            provider={provider}
            name={name}
            replacing={replacing}
            keyError={keyError}
            savedRejected={savedRejected}
            hasValue={!!keyValue.trim()}
            recheck={recheck}
            updatedAt={existing?.updatedAt ?? null}
            formatDate={(value, options) =>
              formatters.formatDate(value, options)
            }
            onRecheck={runRecheck}
          />
        </div>

        {isOpenAi ? (
          endpointOpen ? (
            <div className="grid gap-2">
              <Label htmlFor={ids.endpoint}>{t(`${K}endpointUrl`)}</Label>
              <Input
                id={ids.endpoint}
                type="url"
                value={endpoint}
                autoComplete="off"
                spellCheck={false}
                disabled={saving}
                placeholder={GATEWAY_PLACEHOLDER}
                onChange={(event) => setEndpoint(event.target.value)}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                {t(`${K}endpointHint`)}
              </p>
            </div>
          ) : (
            <button
              type="button"
              className="justify-self-start text-sm font-medium text-foreground underline-offset-4 hover:underline"
              onClick={() => setEndpointOpen(true)}
            >
              {t(`${K}addEndpoint`)}
            </button>
          )
        ) : null}

        <div className="grid gap-2">
          <div className="flex min-h-5 items-center justify-between gap-2">
            <span id={ids.models} className="text-sm font-medium leading-none">
              {t(`${K}models`)}
            </span>
            {listReady && available.length > 0 ? (
              <button
                type="button"
                className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                onClick={() => setChecked(allChecked ? [] : [...available])}
              >
                {allChecked ? t(`${K}clear`) : t(`${K}selectAll`)}
              </button>
            ) : null}
          </div>
          <div
            role="group"
            aria-labelledby={ids.models}
            className="h-44 overflow-y-auto rounded-md border border-input"
          >
            <ModelsBox
              idPrefix={ids.models}
              check={check}
              listReady={listReady}
              available={available}
              checked={checked}
              isOllama={isOllama}
              name={name}
              disabled={saving}
              onToggle={(model, on) =>
                setChecked((previous) =>
                  on
                    ? available.filter(
                        (item) => item === model || previous.includes(item),
                      )
                    : previous.filter((item) => item !== model),
                )
              }
            />
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {fromService && serviceLabel
              ? t(`${K}modelsHintService`, { service: serviceLabel })
              : t(`${K}modelsHint`)}
          </p>
        </div>

        {listing.hasOrganization ? (
          <WhoField
            id={ids.who}
            mode={replaceTarget ? "manage" : mode}
            choice={mode === "add" && whoChoice && !replaceTarget}
            scope={scope}
            orgName={orgName}
            disabled={saving}
            onChange={setScope}
          />
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <IconAlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter className="gap-2 sm:space-x-0">
          {mode === "manage" ? (
            <Button
              type="button"
              variant="secondary-destructive"
              className="sm:me-auto"
              disabled={saving}
              onClick={() => setRemoveOpen(true)}
            >
              {t(`${K}removeProvider`)}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            {t(`${K}cancel`)}
          </Button>
          <Button type="submit" disabled={saving || !ready}>
            {saving ? <Spinner /> : null}
            {primaryLabel}
          </Button>
        </DialogFooter>
      </form>
      {mode === "manage" ? (
        <RemoveProviderDialog
          open={removeOpen}
          onOpenChange={setRemoveOpen}
          provider={provider}
          scope={scope}
          onRemoved={() => {
            onRemoved?.({ provider, scope });
            onOpenChange(false);
          }}
        />
      ) : null}
    </DialogContent>
  );
}

function KeyHint({
  id,
  provider,
  name,
  replacing,
  keyError,
  savedRejected,
  hasValue,
  recheck,
  updatedAt,
  formatDate,
  onRecheck,
}: {
  id: string;
  provider: AgentProviderId;
  name: string;
  replacing: boolean;
  keyError: boolean;
  savedRejected: boolean;
  hasValue: boolean;
  recheck: "idle" | "checking" | { checkedAt: number };
  updatedAt: number | null;
  formatDate: (value: number, options?: Intl.DateTimeFormatOptions) => string;
  onRecheck: () => void;
}) {
  const t = useT();
  const isOllama = provider === "ollama";
  const base = "text-xs leading-5";
  if (keyError) {
    return (
      <p id={id} className={cn(base, "text-destructive")}>
        {isOllama ? t(`${K}endpointFirst`) : t(`${K}pasteFirst`)}
      </p>
    );
  }
  if (!replacing) {
    if (recheck === "checking") {
      return (
        <p
          id={id}
          className={cn(
            base,
            "flex items-center gap-1.5 text-muted-foreground",
          )}
        >
          <Spinner className="size-3" />
          {isOllama ? t(`${K}checkingEndpoint`) : t(`${K}checkingSaved`)}
        </p>
      );
    }
    const checkedText =
      typeof recheck === "object"
        ? t(`${K}checkedJustNow`)
        : updatedAt
          ? t(`${K}checkedOn`, {
              date: formatDate(updatedAt, { dateStyle: "medium" }),
            })
          : null;
    return (
      <p id={id} className={cn(base, "text-muted-foreground")}>
        {checkedText ? `${checkedText} ` : null}
        <button
          type="button"
          className="font-medium text-foreground underline-offset-4 hover:underline"
          onClick={onRecheck}
        >
          {t(`${K}checkAgain`)}
        </button>
      </p>
    );
  }
  if (savedRejected && !hasValue) {
    return (
      <p id={id} className={cn(base, "text-destructive")}>
        {t(`${K}savedRejected`, { provider: name })}
      </p>
    );
  }
  if (isOllama) {
    return (
      <p id={id} className={cn(base, "text-muted-foreground")}>
        {t(`${K}ollamaHint`)}
      </p>
    );
  }
  const host = keyConsoleHost(provider);
  const docsUrl = getAgentProviderOption(provider).docsUrl;
  if (!host || !docsUrl) return <p id={id} className={base} />;
  // The host renders as a link inside the translated sentence.
  const sentence = t(`${K}keyHint`, { host, provider: name });
  const at = sentence.indexOf(host);
  return (
    <p id={id} className={cn(base, "text-muted-foreground")}>
      {at < 0 ? (
        sentence
      ) : (
        <>
          {sentence.slice(0, at)}
          <a
            href={docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-4"
          >
            {host}
          </a>
          {sentence.slice(at + host.length)}
        </>
      )}
    </p>
  );
}

function checkFailureText(
  t: (key: string, options?: Record<string, unknown>) => string,
  check: Extract<CheckState, { state: "failed" }>,
  name: string,
): { headline: string; reason: string } {
  const isOllama = check.provider === "ollama";
  switch (check.code) {
    case "wrong-provider": {
      const detected = check.detectedProvider
        ? providerLabel(check.detectedProvider)
        : name;
      return {
        headline: t(`${K}rejectedHeadline`, { provider: name }),
        reason: /^[aeiou]/i.test(detected)
          ? t(`${K}reasonWrongProviderVowel`, { provider: detected })
          : t(`${K}reasonWrongProvider`, { provider: detected }),
      };
    }
    case "rejected":
    case "missing-key":
      return {
        headline: t(`${K}rejectedHeadline`, { provider: name }),
        reason: check.expectedPrefix
          ? t(`${K}reasonPrefix`, {
              provider: name,
              prefix: check.expectedPrefix,
            })
          : t(`${K}reasonRejected`),
      };
    case "invalid-endpoint":
    case "unreachable":
      return {
        headline: t(`${K}unreachableHeadline`, { provider: name }),
        reason: isOllama
          ? t(`${K}reasonOllamaUnreachable`)
          : check.code === "invalid-endpoint"
            ? t(`${K}reasonEndpoint`)
            : t(`${K}reasonTryAgain`),
      };
    case "provider-error":
      return {
        headline: t(`${K}providerErrorHeadline`, { provider: name }),
        reason: t(`${K}reasonTryAgain`),
      };
  }
}

function ModelsBox({
  idPrefix,
  check,
  listReady,
  available,
  checked,
  isOllama,
  name,
  disabled,
  onToggle,
}: {
  idPrefix: string;
  check: CheckState;
  listReady: boolean;
  available: string[];
  checked: string[];
  isOllama: boolean;
  name: string;
  disabled: boolean;
  onToggle: (model: string, on: boolean) => void;
}) {
  const t = useT();
  const state =
    "flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center text-sm";
  if (check.state === "checking") {
    return (
      <div role="status" className={cn(state, "text-muted-foreground")}>
        <Spinner />
        <span>
          {isOllama
            ? t(`${K}checkingOllama`)
            : t(`${K}checking`, { provider: name })}
        </span>
      </div>
    );
  }
  if (check.state === "failed") {
    const { headline, reason } = checkFailureText(t, check, name);
    return (
      <div role="alert" className={state}>
        <IconAlertCircle className="size-4 text-destructive" aria-hidden />
        <span className="font-medium text-foreground">{headline}</span>
        <span className="text-muted-foreground">{reason}</span>
      </div>
    );
  }
  if (check.state === "error") {
    return (
      <div role="alert" className={state}>
        <IconAlertCircle className="size-4 text-destructive" aria-hidden />
        <span className="text-muted-foreground">{check.message}</span>
      </div>
    );
  }
  if (!listReady) {
    return (
      <div className={cn(state, "text-muted-foreground")}>
        {isOllama ? (
          <IconServer className="size-4" aria-hidden />
        ) : (
          <IconKey className="size-4" aria-hidden />
        )}
        <span>
          {isOllama ? t(`${K}modelsIdleOllama`) : t(`${K}modelsIdle`)}
        </span>
      </div>
    );
  }
  if (available.length === 0) {
    return (
      <div className={cn(state, "text-muted-foreground")}>
        <span>{t(`${K}noModelsFound`)}</span>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border/60">
      {available.map((model, index) => {
        const on = checked.includes(model);
        const inputId = `${idPrefix}-${index}`;
        return (
          <li key={model} className="flex items-center gap-3 px-3 py-2">
            <Checkbox
              id={inputId}
              checked={on}
              disabled={disabled}
              onCheckedChange={(value) => onToggle(model, value === true)}
            />
            <label
              htmlFor={inputId}
              className="min-w-0 flex-1 truncate font-mono text-xs"
            >
              {model}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function WhoField({
  id,
  mode,
  choice,
  scope,
  orgName,
  disabled,
  onChange,
}: {
  id: string;
  mode: ProviderDialogMode;
  choice: boolean;
  scope: AgentEngineKeyScope;
  orgName: string;
  disabled: boolean;
  onChange: (scope: AgentEngineKeyScope) => void;
}) {
  const t = useT();
  const hint =
    mode === "add-from-service"
      ? t(`${K}whoHintService`)
      : choice
        ? t(`${K}whoHintAdmin`, { org: orgName })
        : mode === "add"
          ? t(`${K}whoHintMember`)
          : null;
  return (
    <div className="grid gap-2">
      <span id={id} className="text-sm font-medium leading-none">
        {t(`${K}who`)}
      </span>
      {choice ? (
        <RadioGroup
          aria-labelledby={id}
          value={scope}
          onValueChange={(value) => onChange(value as AgentEngineKeyScope)}
          className="flex flex-wrap gap-5"
          disabled={disabled}
        >
          {(["user", "org"] as const).map((value) => (
            <div key={value} className="flex items-center gap-2">
              <RadioGroupItem id={`${id}-${value}`} value={value} />
              <Label htmlFor={`${id}-${value}`} className="font-normal">
                {value === "org" ? t(`${K}organization`) : t(`${K}personal`)}
              </Label>
            </div>
          ))}
        </RadioGroup>
      ) : (
        <div
          aria-labelledby={id}
          className="flex h-9 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground"
        >
          <IconLock className="size-4 shrink-0" aria-hidden />
          <span>
            {scope === "org" ? t(`${K}organization`) : t(`${K}personal`)}
          </span>
        </div>
      )}
      {hint ? (
        <p className="text-xs leading-5 text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
