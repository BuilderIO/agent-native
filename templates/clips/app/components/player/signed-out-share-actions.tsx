import { appPath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { buildSignInReturnHref } from "@agent-native/core/client/ui";
import { IconExternalLink, IconLogin2 } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

export type SignedOutShareCta = "signin" | "try_clips";

export function buildShareSignInHref(
  recordingId: string,
  startAt?: string | null,
): string {
  const params = new URLSearchParams();
  if (startAt) params.set("at", startAt);
  const query = params.toString();
  return buildSignInReturnHref({
    returnTo: `/share/${recordingId}${query ? `?${query}` : ""}`,
  });
}

export function SignedOutShareActions({
  recordingId,
  startAt,
  onCtaClick,
}: {
  recordingId: string;
  startAt?: string | null;
  onCtaClick?: (cta: SignedOutShareCta) => void;
}) {
  const t = useT();

  return (
    <>
      <Button variant="outline" size="sm" asChild>
        <a
          href={buildShareSignInHref(recordingId, startAt)}
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
