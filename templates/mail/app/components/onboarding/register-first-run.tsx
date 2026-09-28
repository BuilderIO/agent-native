import {
  registerFirstRunOnboardingExtension,
  type FirstRunOnboardingExtensionProps,
} from "@agent-native/core/client/onboarding";

import { AiInboxSetup } from "./AiInboxSetup";

export function MailTriageFirstRun({
  onComplete,
  onSkip,
}: FirstRunOnboardingExtensionProps) {
  return (
    <AiInboxSetup
      embedded
      forceOpen
      onComplete={onComplete}
      onSkipSetup={onSkip}
    />
  );
}

registerFirstRunOnboardingExtension({
  id: "mail-triage",
  component: MailTriageFirstRun,
});
