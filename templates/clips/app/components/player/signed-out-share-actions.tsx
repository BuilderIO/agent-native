import { agentNativePath, appPath, useT } from "@agent-native/core/client";
import { IconExternalLink, IconLogin2 } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

export type SignedOutShareCta = "signin" | "try_clips";

export function buildShareSignInHref(recordingId: string): string {
  return agentNativePath(
    `/_agent-native/sign-in?return=${encodeURIComponent(`/share/${recordingId}`)}`,
  );
}

export function SignedOutShareActions({
  recordingId,
  onCtaClick,
}: {
  recordingId: string;
  onCtaClick?: (cta: SignedOutShareCta) => void;
}) {
  const t = useT();

  return (
    <>
      <Button variant="outline" size="sm" asChild>
        <a
          href={buildShareSignInHref(recordingId)}
          className="gap-1.5"
          onClick={() => onCtaClick?.("signin")}
        >
          <IconLogin2 className="h-4 w-4 rtl:-scale-x-100" />
          {t("sharePage.signIn")}
        </a>
      </Button>
      <Button variant="ghost" size="sm" asChild>
        <a
          href={appPath("/")}
          className="gap-1.5"
          onClick={() => onCtaClick?.("try_clips")}
        >
          {t("sharePage.tryClips")}
          <IconExternalLink className="h-3.5 w-3.5" />
        </a>
      </Button>
    </>
  );
}
