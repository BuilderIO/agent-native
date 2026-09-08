import { trackEvent } from "@agent-native/core/client/analytics";
import { writeClipboardText } from "@agent-native/core/client/clipboard";
import { useT } from "@agent-native/core/client/i18n";
import { buildSignInReturnHref } from "@agent-native/core/client/ui";
import { IconCheck, IconLink } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import {
  PageHeaderActionGroup,
  PageHeaderPrimaryAction,
} from "@/components/library/page-header";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { recordingShareUrl } from "@/lib/recording-link";

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

export function buildShareCopyHref(
  recordingId: string,
  startAt?: string | null,
): string {
  const shareUrl = recordingShareUrl(recordingId);
  if (!startAt) return shareUrl;
  const separator = shareUrl.includes("?") ? "&" : "?";
  return `${shareUrl}${separator}${new URLSearchParams({ at: startAt })}`;
}

export function SignedOutShareActions({
  recordingId,
  startAt,
  onCtaClick,
  onSignup,
}: {
  recordingId: string;
  startAt?: string | null;
  onCtaClick?: (cta: SignedOutShareCta) => void;
  onSignup?: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    },
    [],
  );

  const shareUrl = buildShareCopyHref(recordingId, startAt);
  const copyShareLink = async () => {
    const didCopy = await writeClipboardText(shareUrl);
    if (!didCopy) return;
    trackEvent("share_link_copied", {
      resource_type: "recording",
      resource_id: recordingId,
      link_type: "share",
    });
    setCopied(true);
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => setCopied(false), 1_400);
  };

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
      <PageHeaderActionGroup>
        {onSignup ? (
          <PageHeaderPrimaryAction
            type="button"
            onClick={() => {
              onCtaClick?.("signup");
              onSignup();
            }}
          >
            {t("sharePage.getClipsFree")}
          </PageHeaderPrimaryAction>
        ) : (
          <PageHeaderPrimaryAction asChild>
            <a
              href={buildShareSignUpHref(recordingId, startAt)}
              onClick={() => onCtaClick?.("signup")}
            >
              {t("sharePage.getClipsFree")}
            </a>
          </PageHeaderPrimaryAction>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <PageHeaderPrimaryAction
              type="button"
              className="w-8 px-0 shadow-none"
              aria-label={
                copied
                  ? t("recordRoute.linkCopied")
                  : t("recordRoute.copyLinkAction")
              }
              onClick={() => void copyShareLink()}
            >
              {copied ? (
                <IconCheck className="size-4" />
              ) : (
                <IconLink className="size-4" />
              )}
            </PageHeaderPrimaryAction>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {copied
              ? t("recordRoute.linkCopied")
              : t("recordRoute.copyLinkAction")}
          </TooltipContent>
        </Tooltip>
      </PageHeaderActionGroup>
    </>
  );
}
