import { Button } from "@agent-native/toolkit/ui/button";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { useId, useState, type ReactNode } from "react";

import type { ServiceProviderServiceStatus } from "../../../agent/actions/manage-service-providers.js";
import {
  Dialog,
  DialogContent,
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
  /** Save `provider` as the service's choice. The page updates optimistically. */
  onSave: (provider: ServiceProviderId) => void;
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

  const submit = () => {
    if (step.kind === "add") {
      onAddKey(provider);
      return;
    }
    onOpenChange(false);
    // Saving what's already in effect changes nothing.
    if (provider !== (service.provider ?? service.effectiveProvider)) {
      onSave(provider);
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
      closeLabel={t(`${K}cancel`)}
      aria-describedby={undefined}
      data-service-dialog={service.service}
    >
      <DialogHeader>
        <DialogTitle>{label}</DialogTitle>
      </DialogHeader>
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="text-sm leading-6 text-muted-foreground">{why}</p>
        <div className="grid gap-2">
          <Label htmlFor={selectId}>{t(`${K}provider`)}</Label>
          <Select
            value={provider}
            onValueChange={(value) => setProvider(value as ServiceProviderId)}
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
          {hint ? (
            <p
              className="text-xs leading-5 text-muted-foreground"
              data-service-key-state={keyState}
            >
              {hint}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            className="h-9 px-3"
            onClick={() => onOpenChange(false)}
          >
            {t(`${K}cancel`)}
          </Button>
          <Button type="submit" className="h-9 px-3">
            {primaryLabel}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
