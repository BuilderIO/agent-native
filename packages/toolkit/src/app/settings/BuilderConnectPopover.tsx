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
  getBuilderIncludedBenefitCapabilities,
} from "../onboarding/BuilderIncludedServices.js";
import type { BuilderConnectFlow } from "./useBuilderStatus.js";

type BuilderConnectTrigger = React.ReactElement<{
  onClick?: React.MouseEventHandler<HTMLElement>;
  "aria-busy"?: boolean;
  disabled?: boolean;
}>;

export interface BuilderConnectPopoverProps {
  flow: Pick<BuilderConnectFlow, "connecting" | "start"> & {
    statusResolved?: boolean;
    agentNativeProvisioningEnabled?: boolean;
    accountExists?: boolean;
    cancel?: BuilderConnectFlow["cancel"];
  };
  canProvisionAccount?: boolean;
  children: BuilderConnectTrigger;
  onConnect?: (provisionAccount: boolean) => void;
  onTriggerClick?: React.MouseEventHandler<HTMLElement>;
  openOnMount?: boolean;
  contentTestId?: string;
  primaryTestId?: string;
  secondaryTestId?: string;
}

export interface BuilderConnectChoicePanelProps {
  flow: Pick<BuilderConnectFlow, "connecting">;
  canProvisionAccount: boolean;
  onCreateAndActivate: () => void;
  onExistingAccount: () => void;
  contentTestId?: string;
  primaryTestId?: string;
  secondaryTestId?: string;
}

export function BuilderConnectChoicePanel({
  flow,
  canProvisionAccount,
  onCreateAndActivate,
  onExistingAccount,
  contentTestId,
  primaryTestId,
  secondaryTestId,
}: BuilderConnectChoicePanelProps) {
  const t = useT();

  return (
    <div className="space-y-2.5" data-testid={contentTestId}>
      <h2
        id="builder-connect-popover-title"
        className="text-sm font-semibold text-foreground"
      >
        {t("agentChat.onboarding.builderActivateTitle", {
          defaultValue: "Activate free credits",
        })}
      </h2>
      <p className="text-xs leading-5 text-muted-foreground">
        {t("agentChat.onboarding.builderActivationDescription", {
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
          onClick={onCreateAndActivate}
          disabled={flow.connecting || !canProvisionAccount}
        >
          {flow.connecting ? <Spinner aria-hidden /> : null}
          {flow.connecting
            ? t("agentChat.onboarding.builderActivating", {
                defaultValue: "Activating Builder.io free credits",
              })
            : t("agentChat.onboarding.builderCreateAndActivate", {
                defaultValue: "Create and activate",
              })}
        </Button>
        <Button
          type="button"
          variant="secondary"
          data-testid={secondaryTestId}
          className="w-full"
          onClick={onExistingAccount}
          disabled={flow.connecting}
        >
          {t("agentChat.onboarding.builderExistingAccount", {
            defaultValue: "I have a Builder.io account",
          })}
        </Button>
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">
        {t("agentChat.onboarding.builderConsentPrefix", {
          defaultValue: "By creating a Builder.io account, you agree to our",
        })}{" "}
        <a
          href="https://www.builder.io/legal/terms"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("agentChat.onboarding.builderTerms", {
            defaultValue: "Terms of Service",
          })}
        </a>{" "}
        {t("agentChat.onboarding.builderConsentAnd", {
          defaultValue: "and",
        })}{" "}
        <a
          href="https://www.builder.io/legal/privacy"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("agentChat.onboarding.builderPrivacy", {
            defaultValue: "Privacy Policy",
          })}
        </a>
        .
      </p>
    </div>
  );
}

export function BuilderConnectPopover({
  flow,
  canProvisionAccount,
  children,
  onConnect,
  onTriggerClick,
  openOnMount = false,
  contentTestId,
  primaryTestId,
  secondaryTestId,
}: BuilderConnectPopoverProps) {
  const t = useT();
  const [open, setOpen] = useState(openOnMount);
  const provisioningAttemptRef = useRef(false);

  useEffect(() => {
    if (
      !flow.connecting &&
      flow.accountExists &&
      provisioningAttemptRef.current
    ) {
      provisioningAttemptRef.current = false;
      setOpen(true);
    } else if (!flow.connecting) {
      provisioningAttemptRef.current = false;
    }
  }, [flow.accountExists, flow.connecting]);

  const start = (provisionAccount: boolean) => {
    if (provisionAccount) provisioningAttemptRef.current = true;
    setOpen(false);
    if (onConnect) {
      onConnect(provisionAccount);
      return;
    }
    flow.start({ provisionAccount });
  };

  const trigger = React.cloneElement(children, {
    onClick: (event) => {
      if (flow.connecting) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      children.props.onClick?.(event);
      onTriggerClick?.(event);
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

  const popover = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="center"
        side="right"
        sideOffset={8}
        aria-labelledby="builder-connect-popover-title"
        className="z-[330] max-h-[min(640px,calc(100dvh-2rem),var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-3 text-left"
      >
        <BuilderConnectChoicePanel
          flow={flow}
          canProvisionAccount={
            canProvisionAccount ??
            (flow.statusResolved === true &&
              flow.agentNativeProvisioningEnabled === true)
          }
          onCreateAndActivate={() => start(true)}
          onExistingAccount={() => start(false)}
          contentTestId={contentTestId}
          primaryTestId={primaryTestId}
          secondaryTestId={secondaryTestId}
        />
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
    ? getBuilderIncludedBenefitCapabilities(profile.capabilities)
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
