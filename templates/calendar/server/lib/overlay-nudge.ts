import {
  buildDeepLink,
  getAppProductionUrl,
  isEmailConfigured,
  renderEmail,
  sendEmail,
  toAbsoluteOpenUrl,
} from "@agent-native/core/server";
import { getUserSetting, mutateUserSetting } from "@agent-native/core/settings";

import type { OverlayPerson } from "../../shared/api.js";
import { overlaysBack } from "./booking-host-availability.js";
import { CALENDAR_OVERLAY_ACCESS_REQUEST_EMAIL_ID } from "./emails.js";

const NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

type OverlayNudgeLog = Record<string, string>;

export function renderOverlayAccessRequestEmail({
  ownerEmail,
  calendarUrl,
}: {
  ownerEmail: string;
  calendarUrl: string;
}) {
  return {
    subject: `${ownerEmail} wants to see your working hours`,
    ...renderEmail({
      preheader: `${ownerEmail} added you to their calendar overlay so their booking links can use your real working hours.`,
      heading: "Share your working hours",
      paragraphs: [
        `${ownerEmail} added you to their calendar overlay so their booking links can offer times inside your real working hours, instead of only checking when you're free or busy.`,
        "Add them back to your own calendar overlay to share your working hours with them.",
      ],
      cta: { label: "Open Calendar", url: calendarUrl },
      footer: "You can remove them from your calendar overlay at any time.",
    }),
  };
}

/**
 * Reserves the (owner, peer) nudge slot for `claimedAt` if the cooldown has
 * elapsed, as one atomic derive-and-persist mutation. `mutateUserSetting`
 * retries its updater on write conflicts, so this can run more than once and
 * must stay a pure computation over `current` — no side effects here.
 * Returns the still-active `nextAvailableAt` when the claim is refused.
 */
async function claimNudgeSlot(
  ownerEmail: string,
  peer: string,
  claimedAt: string,
): Promise<{ claimed: boolean; nextAvailableAt?: string }> {
  let claimed = false;
  let nextAvailableAt: string | undefined;
  await mutateUserSetting(ownerEmail, "calendar-overlay-nudges", (current) => {
    const log = (current as OverlayNudgeLog | null) ?? {};
    const lastSent = log[peer];
    if (lastSent) {
      const nextAt = new Date(new Date(lastSent).getTime() + NUDGE_COOLDOWN_MS);
      if (nextAt.getTime() > Date.parse(claimedAt)) {
        claimed = false;
        nextAvailableAt = nextAt.toISOString();
        return log;
      }
    }
    claimed = true;
    nextAvailableAt = undefined;
    return { ...log, [peer]: claimedAt };
  });
  return { claimed, nextAvailableAt };
}

/** Releases a claimed nudge slot, but only if it still holds our exact claim. */
async function releaseNudgeSlot(
  ownerEmail: string,
  peer: string,
  claimedAt: string,
): Promise<void> {
  await mutateUserSetting(ownerEmail, "calendar-overlay-nudges", (current) => {
    const log = (current as OverlayNudgeLog | null) ?? {};
    if (log[peer] !== claimedAt) return log;
    const { [peer]: _removed, ...rest } = log;
    return rest;
  });
}

/**
 * Sends the peer an email asking them to reciprocally overlay the owner back
 * — the only thing that unlocks working-hours-aware scheduling for them (see
 * `booking-host-availability.ts`). Never mutates the owner's overlay list;
 * only nudges toward the peer taking that action themselves. The (owner,
 * peer) cooldown slot is claimed atomically via `mutateUserSetting` before
 * sending, so concurrent requests can't both pass the cooldown check and
 * double-send. If the peer already overlays the owner back, or the email
 * can't actually be delivered, the claim is released (or never taken) so
 * `sent: true` always means an email really went out.
 */
export async function requestOverlayReciprocation({
  ownerEmail,
  peerEmail,
}: {
  ownerEmail: string;
  peerEmail: string;
}): Promise<{
  sent: boolean;
  nextAvailableAt?: string;
  reason?:
    | "cooldown"
    | "already-reciprocal"
    | "email-not-configured"
    | "not-overlaid";
}> {
  const peer = peerEmail.toLowerCase();
  const owner = ownerEmail.toLowerCase();

  const overlayData = (await getUserSetting(
    ownerEmail,
    "calendar-overlay-people",
  )) as { people: OverlayPerson[] } | null;
  const isOverlaid = (overlayData?.people ?? []).some(
    (person) => person.email.toLowerCase() === peer,
  );
  if (!isOverlaid) {
    // A caller acting on stale status data (the peer was removed from the
    // overlay after the status was fetched) is a correctable state, not a
    // server fault. Report it the same way as the other cases where there
    // is nothing to send, instead of throwing an opaque 500.
    return { sent: false, reason: "not-overlaid" };
  }

  if (await overlaysBack(peer, owner)) {
    return { sent: false, reason: "already-reciprocal" };
  }

  const claimedAt = new Date().toISOString();
  const claim = await claimNudgeSlot(ownerEmail, peer, claimedAt);
  if (!claim.claimed) {
    return {
      sent: false,
      nextAvailableAt: claim.nextAvailableAt,
      reason: "cooldown",
    };
  }

  if (!(await isEmailConfigured())) {
    await releaseNudgeSlot(ownerEmail, peer, claimedAt);
    return { sent: false, reason: "email-not-configured" };
  }

  try {
    const calendarUrl = toAbsoluteOpenUrl(
      buildDeepLink({ app: "calendar", view: "calendar" }),
      getAppProductionUrl(),
    );
    await sendEmail({
      to: peerEmail,
      ...renderOverlayAccessRequestEmail({ ownerEmail, calendarUrl }),
      replyTo: ownerEmail,
      templateId: CALENDAR_OVERLAY_ACCESS_REQUEST_EMAIL_ID,
    });
  } catch (err) {
    await releaseNudgeSlot(ownerEmail, peer, claimedAt);
    throw err;
  }

  return { sent: true };
}
