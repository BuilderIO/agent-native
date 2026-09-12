import { IconArrowRight, IconLoader2 } from "@tabler/icons-react";
import React, { useEffect, useRef, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { useT } from "../i18n.js";
import { cn } from "../utils.js";
import type { BuilderConnectFlow } from "./useBuilderStatus.js";

type BuilderConnectTrigger = React.ReactElement<{
  onClick?: React.MouseEventHandler<HTMLElement>;
  "aria-busy"?: boolean;
}>;

export interface BuilderConnectPopoverProps {
  flow: Pick<BuilderConnectFlow, "connecting" | "start"> & {
    agentNativeProvisioningEnabled?: boolean;
    accountExists?: boolean;
    /** Retry the status request without bypassing provisioning consent. */
    retry?: () => void;
    statusResolved?: boolean;
    /** Set when the status read itself failed, so a queued click can stop. */
    error?: string | null;
  };
  children: BuilderConnectTrigger;
  /** Preserve a surface-specific tracking source or callback when choosing a path. */
  onConnect?: (provisionAccount: boolean) => void;
  /** Preserve parent-row click behavior for compact setup controls. */
  onTriggerClick?: React.MouseEventHandler<HTMLElement>;
  /** Start the requested flow even while the initial status read is pending. */
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
  // A click landing before the first status read cannot be answered yet:
  // whether it connects directly or asks for provisioning consent is exactly
  // what that read decides. The trigger renders as an ordinary enabled button
  // for that whole window, which is seconds long on a cold serverless start,
  // so the intent is held rather than discarded.
  const [clickPendingCapability, setClickPendingCapability] = useState(false);
  const statusUnreadable = Boolean(flow.error);

  useEffect(() => {
    if (accountExists && initiatedByThisTriggerRef.current) {
      initiatedByThisTriggerRef.current = false;
      setOpen(true);
    }
  }, [accountExists]);

  const start = (provisionAccount: boolean) => {
    initiatedByThisTriggerRef.current = true;
    setOpen(false);
    if (onConnect) {
      onConnect(provisionAccount);
      return;
    }
    flow.start({ provisionAccount });
  };

  const releaseQueuedClick = () => {
    setClickPendingCapability(false);
    if (showPopover) {
      setOpen(true);
      return;
    }
    start(false);
  };
  const releaseQueuedClickRef = useRef(releaseQueuedClick);
  releaseQueuedClickRef.current = releaseQueuedClick;

  useEffect(() => {
    if (!clickPendingCapability) return;
    if (capabilityResolved) {
      releaseQueuedClickRef.current();
      return;
    }
    // An unresolved capability plus a surfaced read error is a settled
    // failure, not a slow read. Surfaces that render this popover also render
    // `flow.error`, so the user already has the reason; dropping the intent
    // here is what keeps the trigger from sitting busy forever against an
    // unreachable status route.
    if (statusUnreadable) setClickPendingCapability(false);
  }, [clickPendingCapability, capabilityResolved, statusUnreadable]);

  const trigger = React.cloneElement(children, {
    "aria-busy": clickPendingCapability ? true : undefined,
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
        setClickPendingCapability(true);
        flow.retry?.();
        return;
      }
      children.props.onClick?.(event);
      onTriggerClick?.(event);
      if (!showPopover && !event.defaultPrevented) start(false);
    },
  });

  if (!showPopover) return trigger;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={-40}
        aria-labelledby="builder-connect-popover-title"
        data-testid={contentTestId}
        className="z-[110] w-80 max-w-[calc(100vw-2rem)] p-3 text-left"
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
              : t("agentChat.onboarding.builderActivationDescription")}
          </p>
          <button
            type="button"
            data-testid={primaryTestId}
            className={cn(
              "inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-foreground px-4 text-xs font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60",
            )}
            onClick={() => start(accountExists ? false : true)}
            disabled={flow.connecting}
          >
            {flow.connecting ? (
              <IconLoader2 size={14} className="animate-spin" />
            ) : null}
            {accountExists
              ? t("agentChat.auth.logIn")
              : flow.connecting
                ? t("agentChat.onboarding.builderActivating")
                : t("agentChat.onboarding.builderCreateAndActivate")}
            {!accountExists && !flow.connecting ? (
              <IconArrowRight size={15} />
            ) : null}
          </button>
          {!accountExists && (
            <>
              <p className="text-[11px] leading-4 text-muted-foreground">
                {t("agentChat.onboarding.builderConsentPrefix")}{" "}
                <a
                  href="https://www.builder.io/legal/terms"
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("agentChat.onboarding.builderTerms")}
                </a>{" "}
                {t("agentChat.onboarding.builderConsentAnd")}{" "}
                <a
                  href="https://www.builder.io/legal/privacy"
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("agentChat.onboarding.builderPrivacy")}
                </a>
                .
              </p>
              <button
                type="button"
                data-testid={secondaryTestId}
                className="inline-flex min-h-9 w-full items-center justify-center rounded-lg px-4 text-xs font-normal text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
                onClick={() => start(false)}
                disabled={flow.connecting}
              >
                {t("agentChat.onboarding.builderExistingAccount")}
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
