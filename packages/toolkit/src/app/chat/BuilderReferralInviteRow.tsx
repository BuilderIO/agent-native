import { useT } from "@agent-native/core/client/i18n";
import { useActionQuery } from "@agent-native/core/client/use-action";
import type { BuilderReferralInfo } from "@agent-native/core/shared/builder-referrals";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { ShareCopyRow } from "@agent-native/toolkit/sharing";
import { cn } from "@agent-native/toolkit/utils";

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
