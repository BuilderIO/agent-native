import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@agent-native/toolkit/ui/alert";
import { Button } from "@agent-native/toolkit/ui/button";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { IconAlertCircle } from "@tabler/icons-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import type { ServiceProviderServiceStatus } from "../../../agent/actions/manage-service-providers.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { useT } from "../../i18n.js";
import {
  SERVICE_PROVIDER_LABELS,
  initialServiceChoice,
  keyStateOf,
  serviceDialogChoices,
  serviceDialogStep,
  type ServiceProviderId,
} from "./infra-page-state.js";
import { ServiceProviderLogo } from "./logos.js";

const K = "agentChat.settingsInfra.";

export interface ServiceDialogProps {
  service: ServiceProviderServiceStatus | null;
  label: string;
  why: string;
  onOpenChange: (open: boolean) => void;
  /**
   * Save `provider` as the service's choice. The page updates optimistically;
   * the dialog stays open until the write settles and shows a rejection.
   */
  onSave: (provider: ServiceProviderId) => Promise<void>;
  /** Add an organization key for `provider`, then use it. */
  onAddKey: (provider: ServiceProviderId) => void;
  /** Open `provider`'s saved organization key. */
  onManageKey: (provider: ServiceProviderId) => void;
}

/**
 * One service's provider (spec §5.14): its purpose, a Provider select, the
 * organization key state, and a primary button that is always the next step.
 */
export function ServiceDialog(props: ServiceDialogProps) {
  return (
    <Dialog open={props.service !== null} onOpenChange={props.onOpenChange}>
      {props.service ? (
        <ServiceDialogContent {...props} service={props.service} />
      ) : null}
    </Dialog>
  );
}

function ServiceDialogContent({
  service,
  label,
  why,
  onOpenChange,
  onSave,
  onAddKey,
  onManageKey,
}: ServiceDialogProps & { service: ServiceProviderServiceStatus }) {
  const t = useT();
  const selectId = useId();
  const [provider, setProvider] = useState<ServiceProviderId>(() =>
    initialServiceChoice(service),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cancel stays live while a save runs; a save that settles after the
  // dialog closed must not close whichever dialog opened since.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const choices = serviceDialogChoices(service);
  const name = SERVICE_PROVIDER_LABELS[provider];
  const step = serviceDialogStep(service, provider);
  const keyState = keyStateOf(service, provider);

  const primaryLabel =
    step.kind === "use-builder"
      ? t(`${K}useBuilder`)
      : step.kind === "save"
        ? t(`${K}save`)
        : t(`${K}addNamed`, { provider: name });

  const submit = async () => {
    if (saving) return;
    if (step.kind === "add") {
      onAddKey(provider);
      return;
    }
    // Saving what's already in effect changes nothing.
    if (provider === (service.provider ?? service.effectiveProvider)) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(provider);
      if (mounted.current) onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  let hint: ReactNode = null;
  if (provider !== "builder") {
    if (keyState === "org") {
      hint = (
        <>
          {t(`${K}keyOrg`, { provider: name })}{" "}
          <button
            type="button"
            className="font-medium text-foreground underline underline-offset-2"
            onClick={() => onManageKey(provider)}
          >
            {t(`${K}manageKey`)}
          </button>
        </>
      );
    } else if (keyState === "personal") {
      hint = t(`${K}keyPersonal`, { provider: name });
    } else if (keyState === "none") {
      hint = t(`${K}keyNone`, { provider: name });
    } else {
      hint = t(`${K}keyUnavailable`, { provider: name });
    }
  }

  return (
    <DialogContent
      className="max-w-lg"
      closeLabel={t(`${K}close`)}
      data-service-dialog={service.service}
    >
      <DialogHeader>
        <DialogTitle>{label}</DialogTitle>
        <DialogDescription>{why}</DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor={selectId}>{t(`${K}provider`)}</Label>
          <Select
            value={provider}
            disabled={saving}
            onValueChange={(value) => {
              setProvider(value as ServiceProviderId);
              setError(null);
            }}
          >
            <SelectTrigger id={selectId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((id) => (
                <SelectItem key={id} value={id}>
                  <span className="flex items-center gap-2">
                    <ServiceProviderLogo provider={id} size="sm" />
                    {SERVICE_PROVIDER_LABELS[id]}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Every provider but Builder.io has a key line, so switching to
              and from it is the only change that moves the footer. */}
          <p
            className="min-h-5 text-xs leading-5 text-muted-foreground"
            data-service-key-state={hint ? keyState : undefined}
          >
            {hint}
          </p>
        </div>
        {error ? (
          <Alert variant="destructive">
            <IconAlertCircle aria-hidden />
            <AlertTitle>
              {t(`${K}serviceSaveFailed`, { service: label })}
            </AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            {t(`${K}cancel`)}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner aria-hidden /> : null}
            {saving ? t(`${K}saving`) : primaryLabel}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
