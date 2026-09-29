import { randomUUID } from "node:crypto";

import { CORE_BUILDER_CREDIT_LIMIT_EMAIL_ID } from "../email-catalog/system-emails.js";
import { renderTransactionalEmail } from "../email-catalog/templates.js";
import { loadAgentChatMessagesForLocale } from "../localization/core-messages.js";
import {
  LOCALIZATION_SETTING_KEY,
  normalizeLocalizationPreference,
} from "../localization/shared.js";
import { sendEmail } from "../server/email.js";
import {
  deleteUserSetting,
  getUserSetting,
  mutateUserSetting,
} from "../settings/user-settings.js";
import { builderSubscriptionUpgradeUrl } from "../shared/builder-link-tracking.js";

export const BUILDER_CREDIT_LIMIT_EMAIL_ID = CORE_BUILDER_CREDIT_LIMIT_EMAIL_ID;
const CLAIM_LEASE_MS = 10 * 60_000;

function settingKey(orgId: string | null | undefined): string {
  const scope = orgId ? `org:${encodeURIComponent(orgId)}` : "personal";
  return `builder-credit-limit-notice:${scope}`;
}

interface NoticeState {
  status: "sending" | "sent";
  claimToken?: string;
  leaseUntil?: number;
}

function parseNoticeState(
  value: Record<string, unknown> | null,
): NoticeState | null {
  if (value?.status === "sent") return { status: "sent" };
  if (
    value?.status === "sending" &&
    typeof value.claimToken === "string" &&
    typeof value.leaseUntil === "number"
  ) {
    return {
      status: "sending",
      claimToken: value.claimToken,
      leaseUntil: value.leaseUntil,
    };
  }
  return null;
}

async function claimNotice(
  ownerEmail: string,
  orgId: string | null | undefined,
): Promise<string | null> {
  const token = randomUUID();
  let claimed = false;
  await mutateUserSetting(ownerEmail, settingKey(orgId), (current) => {
    const state = parseNoticeState(current);
    if (
      state?.status === "sent" ||
      (state?.status === "sending" && state.leaseUntil! > Date.now())
    ) {
      claimed = false;
      return current ?? {};
    }
    claimed = true;
    return {
      status: "sending",
      claimToken: token,
      leaseUntil: Date.now() + CLAIM_LEASE_MS,
    };
  });
  return claimed ? token : null;
}

async function finishNotice(
  ownerEmail: string,
  orgId: string | null | undefined,
  token: string,
  sent: boolean,
): Promise<void> {
  await mutateUserSetting(ownerEmail, settingKey(orgId), (current) => {
    const state = parseNoticeState(current);
    if (state?.status !== "sending" || state.claimToken !== token) {
      return current ?? {};
    }
    return sent ? { status: "sent" } : {};
  });
}

export async function clearBuilderCreditLimitNotice(
  ownerEmail: string,
  orgId: string | null | undefined,
): Promise<void> {
  await deleteUserSetting(ownerEmail, settingKey(orgId));
}

export async function sendBuilderCreditLimitNotice(input: {
  ownerEmail: string;
  orgId?: string | null;
}): Promise<void> {
  let token: string | null = null;
  let delivered = false;
  try {
    token = await claimNotice(input.ownerEmail, input.orgId);
    if (!token) return;
    const preference = normalizeLocalizationPreference(
      await getUserSetting(input.ownerEmail, LOCALIZATION_SETTING_KEY),
    );
    const locale = preference.locale === "system" ? "en-US" : preference.locale;
    const messages = await loadAgentChatMessagesForLocale(locale);
    const subject = messages["billing.builderCreditLimitTitle"];
    const body = messages["billing.builderCreditLimitEmailBody"];
    const upgradeLabel = messages["billing.builderCreditUpgrade"];
    const upgradeUrl = builderSubscriptionUpgradeUrl(
      "builder_credit_limit_email",
    );
    const email = await renderTransactionalEmail(
      CORE_BUILDER_CREDIT_LIMIT_EMAIL_ID,
      {
        subject,
        heading: subject,
        body,
        upgradeLabel,
        upgradeUrl,
      },
    );
    await sendEmail({
      to: input.ownerEmail,
      ...email,
      templateId: BUILDER_CREDIT_LIMIT_EMAIL_ID,
      app: "core",
      orgId: input.orgId ?? undefined,
      timeoutMs: 10_000,
    });
    delivered = true;
    await finishNotice(input.ownerEmail, input.orgId, token, true);
  } catch (error) {
    if (token && !delivered) {
      try {
        await finishNotice(input.ownerEmail, input.orgId, token, false);
      } catch (releaseError) {
        console.error(
          "[builder-credit-notice] failed to release email claim",
          releaseError,
        );
      }
    }
    console.error("[builder-credit-notice] failed to send limit email", error);
  }
}
