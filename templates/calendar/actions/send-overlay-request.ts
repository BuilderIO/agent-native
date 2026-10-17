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
    const [reciprocity] = await getOverlayReciprocity(ownerEmail, [peerEmail]);
    if (reciprocity && reciprocity.reciprocal) {
      throw new Error("This peer has already added the owner back");
    }

    if (!(await isEmailConfigured())) {
      return {
        email: peerEmail,
        requestSentAt: null,
        emailSent: false,
        skippedReason: "email-not-configured",
      };
    }

    const now = Date.now();

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

        const dailyCounts: Record<string, number> = {};
        for (const [key, count] of Object.entries(state.dailyCounts)) {
          if (key === dayKey || key === overlayRequestDayKey(now - DAY_MS)) {
            dailyCounts[key] = count;
          }
        }

        const trimmed: Record<string, string> = {};
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

        const reservation = PENDING_PREFIX + new Date(now).toISOString();
        trimmed[peerEmail] = reservation;
        dailyCounts[dayKey] = (dailyCounts[dayKey] ?? 0) + 1;
        outcomeRef.current = { kind: "reserved", reservation };
        return { perPeer: trimmed, dailyCounts };
      },
    );

    const outcome = outcomeRef.current;
    if (outcome.kind === "cooldown") {
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
      await mutateUserSetting(
        ownerEmail,
        OVERLAY_REQUESTS_SETTING_KEY,
        (current) => {
          const state = normalizeOverlayRequestState(current);
          const perPeer = { ...state.perPeer };
          const dailyCounts = { ...state.dailyCounts };
          if (perPeer[peerEmail] === reservation) {
            delete perPeer[peerEmail];
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
          if (perPeer[peerEmail] !== reservation) return state;
          perPeer[peerEmail] = nowIso;
          return { perPeer, dailyCounts: state.dailyCounts };
        },
      );
    } catch (err) {
      console.error(
        "[send-overlay-request] failed to confirm sent request",
        err,
      );
    }

    return { email: peerEmail, requestSentAt: nowIso, emailSent: true };
  },
});
