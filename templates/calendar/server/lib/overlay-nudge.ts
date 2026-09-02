import {
  buildDeepLink,
  getAppProductionUrl,
  isEmailConfigured,
  renderEmail,
  sendEmail,
  toAbsoluteOpenUrl,
} from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";

import type { OverlayPerson } from "../../shared/api.js";
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
 * Sends the peer an email asking them to reciprocally overlay the owner back
 * — the only thing that unlocks working-hours-aware scheduling for them (see
 * `booking-host-availability.ts`). Never mutates the owner's overlay list;
 * only nudges toward the peer taking that action themselves. A per-(owner,
 * peer) cooldown, stored on the owner's own settings, prevents this from
 * being used to spam the same person repeatedly.
 */
export async function requestOverlayReciprocation({
  ownerEmail,
  peerEmail,
}: {
  ownerEmail: string;
  peerEmail: string;
}): Promise<{ sent: boolean; nextAvailableAt?: string }> {
  const peer = peerEmail.toLowerCase();

  const overlayData = (await getUserSetting(
    ownerEmail,
    "calendar-overlay-people",
  )) as { people: OverlayPerson[] } | null;
  const isOverlaid = (overlayData?.people ?? []).some(
    (person) => person.email.toLowerCase() === peer,
  );
  if (!isOverlaid) {
    throw new Error("This person is not in your calendar overlay list");
  }

  const log =
    ((await getUserSetting(
      ownerEmail,
      "calendar-overlay-nudges",
    )) as OverlayNudgeLog | null) ?? {};
  const lastSent = log[peer];
  if (lastSent) {
    const nextAvailableAt = new Date(
      new Date(lastSent).getTime() + NUDGE_COOLDOWN_MS,
    );
    if (nextAvailableAt.getTime() > Date.now()) {
      return { sent: false, nextAvailableAt: nextAvailableAt.toISOString() };
    }
  }

  if (await isEmailConfigured()) {
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
  }

  await putUserSetting(ownerEmail, "calendar-overlay-nudges", {
    ...log,
    [peer]: new Date().toISOString(),
  });

  return { sent: true };
}
