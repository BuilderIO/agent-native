import { useT } from "@agent-native/core/client/i18n";
import { buildSignInReturnHref } from "@agent-native/core/client/ui";

import { Button } from "@/components/ui/button";

import { buildSignUpReturnHref } from "./sign-in-prompt-dialog";

export type SignedOutShareCta = "signin" | "signup";

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

export function buildShareSignUpHref(
  recordingId: string,
  startAt?: string | null,
): string {
  const params = new URLSearchParams();
  if (startAt) params.set("at", startAt);
  const query = params.toString();
  return buildSignUpReturnHref(
    `/share/${recordingId}${query ? `?${query}` : ""}`,
  );
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
      <Button variant="ghost" size="sm" asChild>
        <a
          href={buildShareSignInHref(recordingId, startAt)}
          onClick={() => onCtaClick?.("signin")}
        >
          {t("sharePage.signIn")}
        </a>
      </Button>
      <Button size="sm" asChild>
        <a
          href={buildShareSignUpHref(recordingId, startAt)}
          onClick={() => onCtaClick?.("signup")}
        >
          {t("sharePage.getClipsFree")}
        </a>
      </Button>
    </>
  );
}
