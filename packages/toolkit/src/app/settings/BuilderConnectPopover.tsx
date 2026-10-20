import { injectedAgentNativeAppId } from "@agent-native/core/client/app-config";
import { useT } from "@agent-native/core/client/i18n";
import { getOnboardingAppProfileForId } from "@agent-native/core/onboarding/app-profile-data";
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
} from "./BuilderIncludedBenefitsDisclosure.js";
import { currentTemplateId } from "./shell/app-identity.js";
import type {
  BuilderConnectErrorKind,
  BuilderConnectFlow,
} from "./useBuilderStatus.js";

type BuilderConnectTrigger = React.ReactElement<{
  onClick?: React.MouseEventHandler<HTMLElement>;
  "aria-busy"?: boolean;
  disabled?: boolean;
}>;

type BuilderConnectChoiceFlow = Pick<BuilderConnectFlow, "connecting"> & {
  configured?: boolean;
  accountExists?: boolean;
  error?: string | null;
  errorKind?: BuilderConnectErrorKind | null;
  retry?: () => boolean | void;
  statusCheckEnabled?: boolean;
  statusReadSettledCount?: number;
  statusResolved?: boolean;
};

export interface BuilderConnectPopoverProps {
  flow: BuilderConnectChoiceFlow &
    Pick<BuilderConnectFlow, "start"> & {
      agentNativeProvisioningEnabled?: boolean;
      cancel?: BuilderConnectFlow["cancel"];
    };
  canProvisionAccount?: boolean;
  children: BuilderConnectTrigger;
  onConnect?: (provisionAccount: boolean) => void;
  onTriggerClick?: React.MouseEventHandler<HTMLElement>;
  openOnMount?: boolean;
  appId?: string;
  contentTestId?: string;
  primaryTestId?: string;
  secondaryTestId?: string;
}

export interface BuilderConnectChoicePanelProps {
  flow: BuilderConnectChoiceFlow;
  canProvisionAccount: boolean;
  onCreateAndActivate: () => void;
  onExistingAccount: () => void;
  appId?: string;
  contentTestId?: string;
  primaryTestId?: string;
  secondaryTestId?: string;
}

export function BuilderConnectChoicePanel({
  flow,
  canProvisionAccount,
  onCreateAndActivate,
  onExistingAccount,
  appId,
  contentTestId,
  primaryTestId,
  secondaryTestId,
}: BuilderConnectChoicePanelProps) {
  const t = useT();
  const statusReadFailed = flow.errorKind === "status-read";

  return (
    <div
      className="space-y-2.5"
      data-testid={contentTestId}
      aria-busy={flow.connecting}
    >
      <h2
        id="builder-connect-popover-title"
        className="text-sm font-semibold text-foreground"
      >
        {t("agentChat.onboarding.builderActivateTitle", {
          defaultValue: "Activate free credits",
        })}
      </h2>
      {!flow.accountExists ? (
        <p
          id="builder-connect-popover-description"
          className="text-xs leading-5 text-muted-foreground"
          role={flow.connecting ? "status" : undefined}
          aria-live={flow.connecting ? "polite" : undefined}
        >
          {flow.connecting
            ? t("agentChat.onboarding.builderProvisioningDescription", {
                defaultValue:
                  "Creating your Builder.io account and activating free credits.",
              })
            : canProvisionAccount
              ? t("agentChat.onboarding.builderActivationDescription", {
                  defaultValue:
                    "Create a new account to activate free credits, or continue with an existing account.",
                })
              : statusReadFailed
                ? t("agentChat.onboarding.builderActivationCheckFailed", {
                    defaultValue:
                      "Couldn't check whether this app can create new accounts.",
                  })
                : flow.statusCheckEnabled === false
                  ? t(
                      "agentChat.onboarding.builderActivationUnavailableInMode",
                      {
                        defaultValue:
                          "Create a Builder.io account or sign in to connect.",
                      },
                    )
                  : flow.statusResolved === false
                    ? t("agentChat.onboarding.builderActivationChecking", {
                        defaultValue:
                          "Checking whether new account activation is available.",
                      })
                    : t("agentChat.onboarding.builderActivationUnavailable", {
                        defaultValue:
                          "Create a Builder.io account or sign in to connect.",
                      })}
        </p>
      ) : null}
      {flow.accountExists ? (
        <div
          role="alert"
          id="builder-connect-popover-account-exists"
          className="rounded-md bg-muted px-3 py-2 text-xs leading-5"
        >
          <p className="font-medium text-foreground">
            {t("agentChat.onboarding.builderAccountExistsTitle", {
              defaultValue: "You already have a Builder.io account",
            })}
          </p>
          <p className="text-muted-foreground">
            {t("agentChat.onboarding.builderAccountExistsDescription", {
              defaultValue: "Log in to use your account.",
            })}
          </p>
        </div>
      ) : null}
      {flow.error && !statusReadFailed ? (
        <p role="alert" className="text-xs leading-5 text-destructive">
          {flow.error}
        </p>
      ) : null}
      {statusReadFailed ? (
        <div
          role="status"
          className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-xs"
        >
          <span className="text-muted-foreground">
            {t("agentChat.settingsShell.builder.grantsFailed", {
              defaultValue: "Couldn't read the Builder.io connections.",
            })}
          </span>
          {flow.retry ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => flow.retry?.()}
              disabled={flow.connecting}
            >
              {t("agentChat.settingsShell.builder.retry", {
                defaultValue: "Retry",
              })}
            </Button>
          ) : null}
        </div>
      ) : null}
      <BuilderConnectIncludedServices appId={appId} />
      {canProvisionAccount && !flow.accountExists ? (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            data-testid={primaryTestId}
            className="w-full"
            aria-describedby="builder-connect-popover-description"
            onClick={onCreateAndActivate}
            disabled={flow.connecting}
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
      ) : (
        <Button
          type="button"
          data-testid={primaryTestId}
          className="w-full"
          aria-describedby={
            flow.accountExists
              ? "builder-connect-popover-account-exists"
              : "builder-connect-popover-description"
          }
          onClick={onExistingAccount}
          disabled={flow.connecting}
        >
          {flow.connecting ? <Spinner aria-hidden /> : null}
          {flow.accountExists
            ? t("agentChat.onboarding.builderExistingAccount", {
                defaultValue: "I have a Builder.io account",
              })
            : t("agentChat.onboarding.builderConnect", {
                defaultValue: "Connect Builder.io",
              })}
        </Button>
      )}
      {canProvisionAccount && !flow.accountExists ? (
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
      ) : null}
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
  appId,
  contentTestId,
  primaryTestId,
  secondaryTestId,
}: BuilderConnectPopoverProps) {
  const t = useT();
  const [open, setOpen] = useState(openOnMount);
  const provisioningAttemptRef = useRef(false);

  useEffect(() => {
    if (flow.connecting || !provisioningAttemptRef.current) return;
    provisioningAttemptRef.current = false;
    setOpen(!!flow.accountExists || !!flow.error || flow.configured !== true);
  }, [flow.accountExists, flow.configured, flow.connecting, flow.error]);

  const start = (provisionAccount: boolean) => {
    if (provisionAccount) provisioningAttemptRef.current = true;
    else setOpen(false);
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
          appId={appId}
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

function BuilderConnectIncludedServices({ appId }: { appId?: string }) {
  const t = useT();
  const profile = getOnboardingAppProfileForId(
    appId ?? injectedAgentNativeAppId() ?? currentTemplateId() ?? undefined,
  );
  const capabilities = getBuilderIncludedBenefitCapabilities(
    profile.capabilities,
  );

  return (
    <BuilderIncludedBenefitsDisclosure
      capabilities={capabilities}
      includedLabel={t("agentChat.onboarding.builderIncludedFree", {
        defaultValue: "Included free",
      })}
      creditsLabel={t("agentChat.onboarding.builderMonthlyCredits", {
        defaultValue: "60 monthly Agent Credits",
      })}
      loadingLabel={t("agentChat.common.loading")}
      testId="builder-included-services"
    />
  );
}
