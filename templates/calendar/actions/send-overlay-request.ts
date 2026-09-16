import { defineAction } from "@agent-native/core/action";
import {
  getAppProductionUrl,
  getRequestUserEmail,
  isEmailConfigured,
  sendEmail,
  toAbsoluteOpenUrl,
} from "@agent-native/core/server";
import { getUserSetting, mutateUserSetting } from "@agent-native/core/settings";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getOverlayReciprocity } from "../server/lib/booking-host-availability.js";
import {
  getBookingLinkCoHostEmails,
  normalizeBookingHostEmail,
} from "../server/lib/booking-link-utils.js";
import { displayNameFromIdentifier } from "../server/lib/booking-og-image.js";
import { CALENDAR_OVERLAY_REQUEST_EMAIL_ID } from "../server/lib/emails.js";
import { renderOverlayRequestEmail } from "../server/lib/overlay-request-emails.js";
import {
  normalizeOverlayRequestState,
  overlayRequestDayKey,
  OVERLAY_REQUESTS_SETTING_KEY,
  parseOverlayRequestEntry,
  PENDING_PREFIX,
} from "../server/lib/overlay-request-reservation.js";
import type { OverlayPerson, SendOverlayRequestResult } from "../shared/api.js";

const COOLDOWN_MS = 60 * 60 * 1000;
const DAILY_CAP = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
// A crashed or timed-out send must not block the peer forever; after this a
// pending reservation is treated as abandoned and can be retried.
const PENDING_STALE_MS = 2 * 60 * 1000;

export default defineAction({
  description:
    "Email a booking-link co-host asking them to add the link owner back to their calendar, so their real working hours apply instead of free/busy alone. Only works for a peer already in the owner's calendar overlay list, and is rate-limited to one request per peer per hour and 20 per owner per day.",
  schema: z.object({
    email: z
      .string()
      .email()
      .describe(
        "The co-host to ask. Must already be in the owner's overlay list.",
      ),
    bookingLinkId: z
      .string()
      .optional()
      .describe(
        "The booking link being edited. Omit only for a brand-new, unsaved draft that has no id yet.",
      ),
  }),
  http: { method: "POST" },
  run: async (args): Promise<SendOverlayRequestResult> => {
    const callerEmail = getRequestUserEmail();
    if (!callerEmail) throw new Error("no authenticated user");

    let ownerEmail = callerEmail;
    let linkHostEmails: string[] | null = null;

    if (args.bookingLinkId) {
      await assertAccess("booking-link", args.bookingLinkId, "editor");

      const [row] = await getDb()
        .select({
          ownerEmail: schema.bookingLinks.ownerEmail,
          hosts: schema.bookingLinks.hosts,
        })
        .from(schema.bookingLinks)
        .where(eq(schema.bookingLinks.id, args.bookingLinkId));
      if (!row) throw new Error("Booking link not found");

      ownerEmail = row.ownerEmail;
      if (row.ownerEmail.toLowerCase() !== callerEmail.toLowerCase()) {
        linkHostEmails = getBookingLinkCoHostEmails(row);
      }
    }

    const peerEmail = normalizeBookingHostEmail(args.email);
    if (!peerEmail) throw new Error("Invalid email");
    if (linkHostEmails && !linkHostEmails.includes(peerEmail)) {
      throw new Error("This email is not a host on this booking link");
    }

    // Never send to an arbitrary address: the peer must already be someone the
    // owner deliberately added to their own calendar.
    const overlayData = (await getUserSetting(
      ownerEmail,
      "calendar-overlay-people",
    )) as { people: OverlayPerson[] } | null;
    const isOverlaid = (overlayData?.people ?? []).some(
      (person) => person.email.toLowerCase() === peerEmail,
    );
    if (!isOverlaid) {
      throw new Error("This email is not in the owner's calendar overlay list");
    }
    // The UI hides its send button once reciprocal, but this action is
    // independently agent/API-callable, so a direct call could otherwise
    // send a misleading "add me back" email to a peer who already has.
    const [reciprocity] = await getOverlayReciprocity(ownerEmail, [peerEmail]);
    if (reciprocity && reciprocity.reciprocal) {
      throw new Error("This peer has already added the owner back");
    }

    if (!(await isEmailConfigured())) {
      // Reported explicitly rather than coerced into a success: the UI shows a
      // distinct message, and no timestamp is recorded for a send that never
      // happened, so no rate-limit slot is spent on a send that can't happen.
      return {
        email: peerEmail,
        requestSentAt: null,
        emailSent: false,
        skippedReason: "email-not-configured",
      };
    }

    const now = Date.now();

    // The cooldown/cap check and the reservation write must be one atomic
    // step: reading `requests` and writing it back separately (as before)
    // let two concurrent calls both pass the check before either write
    // landed, sending duplicate emails and bypassing the daily cap. The
    // updater below runs inside mutateUserSetting's compare-and-swap retry
    // loop, so the decision and the reservation happen together.
    type ReservationOutcome =
      | { kind: "cooldown"; sentAt: string }
      | { kind: "in-progress" }
      | { kind: "cap" }
      | { kind: "reserved"; reservation: string };
    const outcomeRef: { current: ReservationOutcome } = {
      current: { kind: "cap" },
    };
    const dayKey = overlayRequestDayKey(now);

    await mutateUserSetting(
      ownerEmail,
      OVERLAY_REQUESTS_SETTING_KEY,
      (current) => {
        const state = normalizeOverlayRequestState(current);

        // The cap is a fixed-window count of sends per UTC day, keyed
        // separately from the per-peer map: unlike the per-peer map, a resend
        // to the same peer must still count as a second send against the cap,
        // not overwrite a single shared slot. Only the current and previous
        // day are kept so this bucket stays bounded.
        const dailyCounts: Record<string, number> = {};
        for (const [key, count] of Object.entries(state.dailyCounts)) {
          if (key === dayKey || key === overlayRequestDayKey(now - DAY_MS)) {
            dailyCounts[key] = count;
          }
        }

        const trimmed: Record<string, string> = {};
        // Entries older than a day can no longer affect the cooldown, so drop
        // them instead of growing this setting forever. A pending reservation
        // older than PENDING_STALE_MS is abandoned (crashed send) and is
        // dropped too, rather than blocking the peer permanently. Its daily
        // count is released along with it: the reservation incremented the
        // cap optimistically before delivery, and if it never completed, a
        // crashed/timed-out send must not permanently burn one of the
        // owner's 20 daily slots.
        for (const [email, value] of Object.entries(state.perPeer)) {
          const { sentAt, pending } = parseOverlayRequestEntry(value);
          if (sentAt === null || now - sentAt >= DAY_MS) continue;
          if (pending && now - sentAt > PENDING_STALE_MS) {
            const staleDayKey = overlayRequestDayKey(sentAt);
            if (dailyCounts[staleDayKey]) {
              dailyCounts[staleDayKey] -= 1;
            }
            continue;
          }
          trimmed[email] = value;
        }

        const existing = trimmed[peerEmail];
        if (existing) {
          const { sentAt, pending } = parseOverlayRequestEntry(existing);
          // A pending reservation means a send is already in flight for this
          // peer (held by another call, since this call hasn't reserved yet).
          // It is not a completed send and must never be reported as one.
          if (pending) {
            outcomeRef.current = { kind: "in-progress" };
            return { perPeer: trimmed, dailyCounts };
          }
          if (sentAt !== null && now - sentAt < COOLDOWN_MS) {
            outcomeRef.current = { kind: "cooldown", sentAt: existing };
            return { perPeer: trimmed, dailyCounts };
          }
        }

        if ((dailyCounts[dayKey] ?? 0) >= DAILY_CAP) {
          outcomeRef.current = { kind: "cap" };
          return { perPeer: trimmed, dailyCounts };
        }

        // Reserved optimistically now (not on confirmed send) so a burst of
        // concurrent reservations for distinct peers still can't exceed the
        // cap while their sends are in flight; released again on failure below.
        const reservation = PENDING_PREFIX + new Date(now).toISOString();
        trimmed[peerEmail] = reservation;
        dailyCounts[dayKey] = (dailyCounts[dayKey] ?? 0) + 1;
        outcomeRef.current = { kind: "reserved", reservation };
        return { perPeer: trimmed, dailyCounts };
      },
    );

    const outcome = outcomeRef.current;
    if (outcome.kind === "cooldown") {
      // Idempotent inside the cooldown, so a double-click or a second tab
      // gets the existing timestamp back instead of sending a second email.
      return {
        email: peerEmail,
        requestSentAt: outcome.sentAt,
        emailSent: false,
      };
    }
    if (outcome.kind === "in-progress") {
      return {
        email: peerEmail,
        requestSentAt: null,
        emailSent: false,
        skippedReason: "send-in-progress",
      };
    }
    if (outcome.kind === "cap") {
      throw new Error(
        "Too many calendar-access requests sent today. Try again tomorrow.",
      );
    }
    const reservation = outcome.reservation;

    // A dedicated page, not a deep-link-triggered modal: the recipient is a
    // cold click from an email, often in a fresh tab with no existing
    // app-state session, and a modal popping open over their calendar with
    // no explanation is easy to misread as a glitch. A real route keyed only
    // off this URL avoids the cross-tab/app-state plumbing entirely and
    // gives the recipient actual context before they act.
    // The owner, not the peer: the peer is the recipient, being asked to add
    // the owner back.
    const appLink = toAbsoluteOpenUrl(
      `/shared-availability/add?email=${encodeURIComponent(ownerEmail)}`,
      getAppProductionUrl(),
    );

    try {
      await sendEmail({
        to: peerEmail,
        ...renderOverlayRequestEmail({
          requesterName: displayNameFromIdentifier(undefined, ownerEmail),
          requesterEmail: ownerEmail,
          appLink,
        }),
        replyTo: ownerEmail,
        templateId: CALENDAR_OVERLAY_REQUEST_EMAIL_ID,
        timeoutMs: PENDING_STALE_MS - 30000,
      });
    } catch (err) {
      // Release the reservation so a send failure doesn't permanently burn
      // this peer's cooldown slot or count against the daily cap. Only clear
      // it if it's still *this* invocation's reservation: PENDING_STALE_MS
      // lets another caller reclaim the slot if this one runs long, and that
      // newer reservation/confirmation must not be clobbered by this one
      // finishing late.
      await mutateUserSetting(
        ownerEmail,
        OVERLAY_REQUESTS_SETTING_KEY,
        (current) => {
          const state = normalizeOverlayRequestState(current);
          const perPeer = { ...state.perPeer };
          const dailyCounts = { ...state.dailyCounts };
          if (perPeer[peerEmail] === reservation) {
            delete perPeer[peerEmail];
            // Only release this call's own reservation slot from the cap; a
            // newer call may already have reclaimed the peer entry above (in
            // which case this branch doesn't run) or incremented a later day.
            dailyCounts[dayKey] = Math.max(0, (dailyCounts[dayKey] ?? 0) - 1);
          }
          return { perPeer, dailyCounts };
        },
      );
      throw err;
    }

    const nowIso = new Date(now).toISOString();
    try {
      await mutateUserSetting(
        ownerEmail,
        OVERLAY_REQUESTS_SETTING_KEY,
        (current) => {
          const state = normalizeOverlayRequestState(current);
          const perPeer = { ...state.perPeer };
          // Same ownership guard as the failure path above: don't overwrite a
          // newer reservation or confirmation with this late-finishing call's.
          // The daily count was already incremented at reservation time above,
          // so a confirmed send doesn't increment it again.
          if (perPeer[peerEmail] !== reservation) return state;
          perPeer[peerEmail] = nowIso;
          return { perPeer, dailyCounts: state.dailyCounts };
        },
      );
    } catch (err) {
      // The email already sent, so throwing here would report a delivered
      // request as failed and invite an immediate, avoidable resend. Log and
      // report success instead; the dangling `pending:` marker still expires
      // after PENDING_STALE_MS like any other abandoned reservation.
      console.error(
        "[send-overlay-request] failed to confirm sent request",
        err,
      );
    }

    return { email: peerEmail, requestSentAt: nowIso, emailSent: true };
  },
});
