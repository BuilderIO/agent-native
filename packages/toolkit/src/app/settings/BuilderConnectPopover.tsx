import { useT } from "@agent-native/core/client/i18n";
import { useOnboarding } from "@agent-native/core/client/onboarding/use-onboarding";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import React, { useEffect, useRef, useState } from "react";

import {
  BuilderIncludedBenefitsDisclosure,
  getBuilderIncludedCapabilities,
} from "../onboarding/BuilderIncludedServices.js";
import type { BuilderConnectFlow } from "./useBuilderStatus.js";

type BuilderConnectTrigger = React.ReactElement<{
  onClick?: React.MouseEventHandler<HTMLElement>;
  "aria-busy"?: boolean;
  disabled?: boolean;
}>;

export interface BuilderConnectPopoverProps {
  flow: Pick<BuilderConnectFlow, "connecting" | "start"> & {
    accountExists?: boolean;
    cancel?: BuilderConnectFlow["cancel"];
    agentNativeProvisioningEnabled?: boolean;
    retry?: () => boolean | void;
    statusResolved?: boolean;
    statusReadSettledCount?: number;
    provisionAccount?: boolean;
  };
  children: BuilderConnectTrigger;
  onConnect?: (provisionAccount: boolean) => void;
  onTriggerClick?: React.MouseEventHandler<HTMLElement>;
  defaultProvisionAccount?: boolean;
  contentTestId?: string;
  primaryTestId?: string;
  secondaryTestId?: string;
}

export function BuilderConnectPopover({
  flow,
  children,
  onConnect,
  onTriggerClick,
  defaultProvisionAccount = false,
  contentTestId,
  primaryTestId,
  secondaryTestId,
}: BuilderConnectPopoverProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const previousAccountExistsRef = useRef(flow.accountExists === true);
  const capabilityResolved = flow.statusResolved === true;
  const showPopover =
    (defaultProvisionAccount && !capabilityResolved) ||
    (capabilityResolved && flow.agentNativeProvisioningEnabled === true);
  const [queuedClick, setQueuedClick] = useState<{ settledAt: number } | null>(
    null,
  );
  const settledCount = flow.statusReadSettledCount ?? 0;

  useEffect(() => {
    const newlyFoundAccount =
      flow.accountExists === true && !previousAccountExistsRef.current;
    previousAccountExistsRef.current = flow.accountExists === true;
    if (newlyFoundAccount) setOpen(true);
  }, [flow.accountExists]);

  const start = (provisionAccount?: boolean) => {
    const shouldProvision =
      provisionAccount ??
      (flow.agentNativeProvisioningEnabled === true &&
        (defaultProvisionAccount || flow.provisionAccount === true));
    setOpen(false);
    if (onConnect) {
      onConnect(shouldProvision);
      return;
    }
    flow.start({ provisionAccount: shouldProvision });
  };

  const openQueuedPopoverRef = useRef<() => void>(() => {});
  openQueuedPopoverRef.current = () => {
    setQueuedClick(null);
    if (showPopover) setOpen(true);
  };

  useEffect(() => {
    if (!queuedClick) return;
    if (capabilityResolved) {
      openQueuedPopoverRef.current();
      return;
    }
    if (settledCount !== queuedClick.settledAt) setQueuedClick(null);
  }, [queuedClick, capabilityResolved, settledCount]);

  const trigger = React.cloneElement(children, {
    "aria-busy": queuedClick ? true : undefined,
    onClick: (event) => {
      if (flow.connecting) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!capabilityResolved) {
        event.preventDefault();
        event.stopPropagation();
        if (defaultProvisionAccount) {
          setOpen(true);
          return;
        }
        if (queuedClick) return;
        if (flow.retry?.() === true) {
          setQueuedClick({ settledAt: settledCount });
        }
        return;
      }
      children.props.onClick?.(event);
      onTriggerClick?.(event);
      if (!showPopover && !event.defaultPrevented) start();
    },
  });

  const cancelAction =
    flow.connecting && flow.cancel ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0"
        onClick={flow.cancel}
      >
        {t("common.cancel")}
      </Button>
    ) : null;

  if (!showPopover) {
    return cancelAction ? (
      <span className="inline-flex max-w-full items-center gap-2">
        <span className="contents">{trigger}</span>
        {cancelAction}
      </span>
    ) : (
      <span className="contents">{trigger}</span>
    );
  }

  const popover = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="center"
        side="right"
        sideOffset={8}
        aria-labelledby="builder-connect-popover-title"
        data-testid={contentTestId}
        className="z-[330] max-h-[min(640px,calc(100dvh-2rem),var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-3 text-left"
      >
        <div className="space-y-2.5">
          <h2
            id="builder-connect-popover-title"
            className="text-sm font-semibold text-foreground"
          >
            {t("agentChat.onboarding.builderActivateTitle")}
          </h2>
          <p
            role={flow.accountExists ? "status" : undefined}
            className="text-xs leading-5 text-muted-foreground"
          >
            {flow.accountExists
              ? t("agentChat.onboarding.builderAccountExistsTitle", {
                  defaultValue: "You already have a Builder.io account",
                })
              : t("agentChat.onboarding.builderActivationDescription", {
                  defaultValue:
                    "Create or connect a Builder.io account in one click to get free credits.",
                })}
          </p>
          <BuilderConnectIncludedServices />
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              data-testid={primaryTestId}
              className="w-full"
              onClick={() => start(!flow.accountExists)}
              disabled={flow.connecting}
            >
              {flow.connecting ? <Spinner aria-hidden /> : null}
              {flow.connecting
                ? t("agentChat.onboarding.builderActivating")
                : t("agentChat.onboarding.builderCreateAndActivate")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              data-testid={secondaryTestId}
              className="w-full"
              onClick={() => start(false)}
              disabled={flow.connecting}
            >
              {t("agentChat.onboarding.builderExistingAccount")}
            </Button>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {t("agentChat.onboarding.builderConsentPrefix")}{" "}
            <a
              href="https://www.builder.io/legal/terms"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("agentChat.onboarding.builderTerms")}
            </a>{" "}
            {t("agentChat.onboarding.builderConsentAnd")}{" "}
            <a
              href="https://www.builder.io/legal/privacy"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("agentChat.onboarding.builderPrivacy")}
            </a>
            .
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );

  return cancelAction ? (
    <span className="inline-flex max-w-full items-center gap-2">
      {popover}
      {cancelAction}
    </span>
  ) : (
    popover
  );
}

function BuilderConnectIncludedServices() {
  const t = useT();
  const { profile, loading, error } = useOnboarding();
  const capabilities = profile
    ? getBuilderIncludedCapabilities(profile.capabilities)
    : [];

  return (
    <BuilderIncludedBenefitsDisclosure
      capabilities={capabilities}
      includedLabel={t("agentChat.onboarding.builderIncludedFree", {
        defaultValue: "Included free",
      })}
      creditsLabel={t("agentChat.onboarding.builderMonthlyCredits", {
        defaultValue: "60 monthly Agent Credits",
      })}
      loading={loading}
      loadingLabel={t("agentChat.common.loading")}
      error={
        error || (!loading && !profile)
          ? t("agentChat.common.chunkLoadFailed")
          : null
      }
      testId="builder-included-services"
    />
  );
}
