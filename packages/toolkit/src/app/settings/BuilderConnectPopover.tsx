import { useT } from "@agent-native/core/client/i18n";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { IconArrowRight } from "@tabler/icons-react";
import React, { useEffect, useRef, useState } from "react";

import type { BuilderConnectFlow } from "./useBuilderStatus.js";

type BuilderConnectTrigger = React.ReactElement<{
  onClick?: React.MouseEventHandler<HTMLElement>;
  "aria-busy"?: boolean;
  disabled?: boolean;
}>;

export interface BuilderConnectPopoverProps {
  flow: Pick<BuilderConnectFlow, "connecting" | "start"> & {
    cancel?: BuilderConnectFlow["cancel"];
    agentNativeProvisioningEnabled?: boolean;
    accountExists?: boolean;
    retry?: () => boolean | void;
    statusResolved?: boolean;
    statusReadSettledCount?: number;
    canConnect?: BuilderConnectFlow["canConnect"];
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
  const capabilityResolved = flow.statusResolved === true;
  const showPopover =
    (defaultProvisionAccount && !capabilityResolved) ||
    (capabilityResolved && flow.agentNativeProvisioningEnabled === true);
  const accountExists = capabilityResolved && flow.accountExists;
  const initiatedByThisTriggerRef = useRef(false);
  const [queuedClick, setQueuedClick] = useState<{ settledAt: number } | null>(
    null,
  );
  const settledCount = flow.statusReadSettledCount ?? 0;

  useEffect(() => {
    if (accountExists && initiatedByThisTriggerRef.current) {
      initiatedByThisTriggerRef.current = false;
      setOpen(true);
    }
  }, [accountExists]);

  const start = (provisionAccount?: boolean) => {
    const shouldProvision =
      provisionAccount ??
      (flow.agentNativeProvisioningEnabled === true &&
        (defaultProvisionAccount || flow.provisionAccount === true));
    initiatedByThisTriggerRef.current = true;
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
        {trigger}
        {cancelAction}
      </span>
    ) : (
      trigger
    );
  }

  const popover = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={-40}
        aria-labelledby="builder-connect-popover-title"
        data-testid={contentTestId}
        className="z-[330] w-80 max-w-[calc(100vw-2rem)] p-3 text-left"
      >
        <div className="space-y-2.5">
          <h2
            id="builder-connect-popover-title"
            className="text-sm font-semibold text-foreground"
          >
            {accountExists
              ? t("agentChat.onboarding.builderAccountExistsTitle")
              : t("agentChat.onboarding.builderActivateTitle")}
          </h2>
          <p className="text-xs leading-5 text-muted-foreground">
            {accountExists
              ? t("agentChat.onboarding.builderAccountExistsDescription")
              : flow.canConnect?.org
                ? t("agentChat.onboarding.builderOrgActivationDescription")
                : t("agentChat.onboarding.builderActivationDescription")}
          </p>
          <div className="flex flex-col gap-1 rounded-[10px] bg-emerald-50 px-4 py-3 dark:bg-emerald-950/30">
            <p className="text-[13px] font-semibold text-foreground">
              {t("agentChat.onboarding.builderIncludedFreeWithAccount", {
                defaultValue: "Included free with a Builder.io account",
              })}
            </p>
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              {t("agentChat.onboarding.builderMonthlyCredits", {
                defaultValue: "60 monthly Agent Credits",
              })}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              data-testid={primaryTestId}
              className="w-full"
              onClick={() => start(accountExists ? false : true)}
              disabled={flow.connecting}
            >
              {flow.connecting ? <Spinner aria-hidden /> : null}
              {accountExists
                ? t("agentChat.auth.logIn")
                : flow.connecting
                  ? t("agentChat.onboarding.builderActivating")
                  : t("agentChat.onboarding.builderCreateAndActivate")}
              {!accountExists && !flow.connecting ? (
                <IconArrowRight aria-hidden />
              ) : null}
            </Button>
            {!accountExists && (
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
            )}
          </div>
          {!accountExists && (
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
          )}
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
