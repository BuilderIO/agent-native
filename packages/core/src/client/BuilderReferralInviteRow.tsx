import { ShareCopyRow } from "@agent-native/toolkit/sharing";

import type { BuilderReferralInfo } from "../shared/builder-referrals.js";
import { writeClipboardText } from "./clipboard.js";
import { useT } from "./i18n.js";
import { useActionQuery } from "./use-action.js";
import { cn } from "./utils.js";

export function BuilderReferralInviteRow({
  className,
}: {
  className?: string;
}) {
  const t = useT();
  const referralQuery = useActionQuery<BuilderReferralInfo | null>(
    "get-builder-referral-info",
    {},
    { staleTime: 5 * 60_000 },
  );
  const referralInfo = referralQuery.data;
  if (!referralInfo?.eligible || !referralInfo.inviteUrl) return null;

  return (
    <ShareCopyRow
      className={cn("min-w-0", className)}
      value={referralInfo.inviteUrl}
      label={t("agentChat.usage.inviteFriends")}
      description={t("agentChat.usage.inviteCredits", {
        amount: referralInfo.creditsPerReferral.toLocaleString(),
      })}
      copyLabel={t("agentChat.usage.copyInviteLink")}
      copiedLabel={t("agentChat.usage.inviteLinkCopied")}
      onCopy={writeClipboardText}
    />
  );
}
