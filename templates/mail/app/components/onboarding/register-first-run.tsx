import {
  registerFirstRunOnboardingExtension,
  type FirstRunOnboardingExtensionProps,
} from "@agent-native/core/client/onboarding";

import { AiInboxSetup } from "./AiInboxSetup";

export function MailTriageFirstRun({
  onComplete,
  onSkip,
  onStepChange,
}: FirstRunOnboardingExtensionProps) {
  return (
    <AiInboxSetup
      embedded
      forceOpen
      firstRunStage="preferences"
      onStepChange={onStepChange}
      onComplete={onComplete}
      onSkip={onSkip}
    />
  );
}

registerFirstRunOnboardingExtension({
  id: "mail-triage-preferences",
  component: MailTriageFirstRun,
  placement: "before-setup",
  stepCount: 3,
});

export function MailTriageSorting({
  onComplete,
  onSkip,
}: FirstRunOnboardingExtensionProps) {
  return (
    <AiInboxSetup
      embedded
      forceOpen
      firstRunStage="sorting"
      onComplete={onComplete}
      onSkip={onSkip}
    />
  );
}

registerFirstRunOnboardingExtension({
  id: "mail-triage-sorting",
  component: MailTriageSorting,
  placement: "after-setup",
  stepCount: 1,
});
