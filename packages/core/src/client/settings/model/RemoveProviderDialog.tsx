import { Alert, AlertDescription } from "@agent-native/toolkit/ui/alert";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Button } from "@agent-native/toolkit/ui/button";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { IconAlertCircle } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type {
  SecretRemovalEffect,
  SecretRemovalPreview,
} from "../../../secrets/usage.js";
import {
  deleteAgentEngineProviderSettings,
  type AgentEngineKeyScope,
} from "../../agent-engine-key.js";
import {
  getAgentProviderOption,
  type AgentProviderId,
} from "../../agent-provider-catalog.js";
import { useT } from "../../i18n.js";
import { useOrg } from "../../org/hooks.js";
import { useActionQuery } from "../../use-action.js";
import { providerLabel } from "./model-page-state.js";

const K = "agentChat.settingsModel.";

export interface RemoveProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: AgentProviderId;
  scope: AgentEngineKeyScope;
  onRemoved?: () => void;
}

/** The stored key a provider's removal deletes: its API key, or Ollama's URL. */
export function providerSecretKey(provider: AgentProviderId): string {
  const option = getAgentProviderOption(provider);
  return (provider === "ollama" ? option.endpointKey : option.key) ?? "";
}

/**
 * "Remove {Provider}?" with who it affects and what stops or switches, per
 * app and feature, from `preview-secret-removal`.
 */
export function RemoveProviderDialog(props: RemoveProviderDialogProps) {
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <RemoveProviderContent {...props} /> : null}
    </AlertDialog>
  );
}

function RemoveProviderContent({
  onOpenChange,
  provider,
  scope,
  onRemoved,
}: RemoveProviderDialogProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const org = useOrg();
  const name = providerLabel(provider);
  const preview = useActionQuery<SecretRemovalPreview>(
    "preview-secret-removal" as never,
    { key: providerSecretKey(provider), scope } as never,
  );
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (removing) return;
    setRemoving(true);
    setError(null);
    try {
      await deleteAgentEngineProviderSettings({ provider, scope });
      void queryClient.invalidateQueries({ queryKey: ["action"] });
      onOpenChange(false);
      onRemoved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoving(false);
    }
  };

  const affectsOrg = preview.data
    ? preview.data.affects === "organization"
    : scope === "org";
  const appName = (app: string) => {
    if (app === "all") return t(`${K}allApps`);
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
          {t(`${K}removeTitle`, { provider: name })}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {affectsOrg
            ? t(`${K}affectsOrg`, { org: org.data?.orgName ?? "" })
            : t(`${K}affectsYou`)}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="grid gap-4 text-sm">
        <div className="grid gap-2">
          <p className="font-medium">{t(`${K}whatHappens`)}</p>
          <div className="overflow-hidden rounded-lg border border-border/70">
            {preview.isError ? (
              <p className="px-4 py-3 text-muted-foreground">
                {t(`${K}previewFailed`)}
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
                {t(`${K}nothingElse`)}
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
        {error ? (
          <Alert variant="destructive">
            <IconAlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
      <AlertDialogFooter>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onOpenChange(false)}
        >
          {t(`${K}cancel`)}
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={removing}
          onClick={() => void remove()}
        >
          {removing ? <Spinner /> : null}
          {removing ? t(`${K}removing`) : t(`${K}removeProvider`)}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

/** Localized copy for the effects the preview derives; others are its own English. */
export function effectText(
  t: (key: string, options?: Record<string, unknown>) => string,
  effect: SecretRemovalEffect,
): string {
  switch (effect.code) {
    case "models-leave-picker":
      return t(`${K}effectModelsLeave`, {
        provider: effect.params?.provider ?? "",
      });
    case "default-model-switches":
      return t(`${K}effectDefaultSwitches`, {
        next: effect.params?.next ?? "",
      });
    case "default-model-stops":
      return t(`${K}effectDefaultStops`);
    case "shared-key-takes-over":
      return effect.params?.source === "workspace"
        ? t(`${K}effectKeepsWorkspace`)
        : effect.params?.source === "vault"
          ? t(`${K}effectKeepsVault`)
          : t(`${K}effectKeepsOrg`);
    default:
      return effect.effect;
  }
}
