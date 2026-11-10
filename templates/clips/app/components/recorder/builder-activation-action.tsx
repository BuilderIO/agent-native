import { useT } from "@agent-native/core/client/i18n";
import { IconAlertTriangle } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { BuilderConsent } from "./builder-consent";
import type { useBuilderStorageActivation } from "./use-builder-storage-activation";

type Activation = ReturnType<typeof useBuilderStorageActivation>;

/**
 * The one Builder.io button a no-account surface shows, with its exceptions
 * in the same place: an existing account signs in instead, and a setup that
 * didn't finish retries in place.
 */
export function BuilderActivationAction({
  activation,
  label,
  secondary,
  className,
}: {
  activation: Activation;
  label: string;
  /** A second button beside the primary one, such as Learn more. */
  secondary?: ReactNode;
  className?: string;
}) {
  const t = useT();
  const { state } = activation;
  const busy = state === "creating" || state === "finishing";

  const primary =
    state === "account-exists" ? (
      <Button type="button" className="flex-1" onClick={activation.signIn}>
        {t("freeClips.signIn")}
      </Button>
    ) : state === "failed" ? (
      <Button
        type="button"
        variant="outline"
        className="flex-1"
        onClick={activation.activate}
      >
        {t("freeClips.tryAgain")}
      </Button>
    ) : (
      <Button
        type="button"
        className="flex-1"
        disabled={busy || state === "connected" || state === "not-allowed"}
        aria-busy={busy}
        onClick={activation.activate}
      >
        {busy ? <Spinner aria-hidden /> : null}
        {state === "connected" ? t("storageSetup.builderConnected") : label}
      </Button>
    );

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      {state === "account-exists" ? (
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          {t("freeClips.accountExists")}
        </p>
      ) : null}
      {state === "failed" ? (
        <p
          role="alert"
          className="flex items-center gap-1.5 text-[13px] leading-[18px] text-amber-700 dark:text-amber-400"
        >
          <IconAlertTriangle className="size-4 shrink-0" aria-hidden />
          {t("freeClips.setupFailed")}
        </p>
      ) : null}
      {state === "not-allowed" ? (
        <p
          role="alert"
          className="text-[13px] leading-[18px] text-muted-foreground"
        >
          {t("storageSetup.builderGrantAskAdmin")}
        </p>
      ) : null}
      <div className="flex w-full gap-3">
        {secondary}
        {primary}
      </div>
      {busy ? (
        <p
          role="status"
          className="text-center text-xs leading-4 text-muted-foreground"
        >
          {state === "creating"
            ? t("freeClips.creatingAccount")
            : t("freeClips.finishingSetup")}
        </p>
      ) : activation.createsAccount &&
        (state === "idle" || state === "failed") ? (
        <BuilderConsent />
      ) : null}
    </div>
  );
}
