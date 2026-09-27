import { useT } from "@agent-native/core/client/i18n";
import {
  registerFirstRunOnboardingExtension,
  type FirstRunOnboardingExtensionProps,
} from "@agent-native/core/client/onboarding";

import { GoogleConnectBanner } from "@/components/GoogleConnectBanner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";

import { AiInboxSetup } from "./AiInboxSetup";

export function MailTriageFirstRun({
  onComplete,
  onSkip,
}: FirstRunOnboardingExtensionProps) {
  const t = useT();
  const googleStatus = useGoogleAuthStatus();
  const connected = (googleStatus.data?.accounts.length ?? 0) > 0;

  if (googleStatus.isLoading) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6" aria-busy="true">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-10 w-28" />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <GoogleConnectBanner variant="hero" />
        <div className="mt-6 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onSkip}>
            {t("mail.sort.aiSetupSkipSetup")}
          </Button>
        </div>
      </div>
    );
  }

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
