import { readBody, getSession } from "@agent-native/core/server";
import {
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";

import * as googleCalendar from "../lib/google-calendar.js";

async function uEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  if (!session?.email) {
    const { createError } = await import("h3");
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  return session.email;
}

class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

async function resolveAccountEmail(
  requestAccountEmail: string | undefined,
  ownerEmail: string,
): Promise<string> {
  if (requestAccountEmail === ownerEmail) {
    return ownerEmail;
  }
  const status = await googleCalendar.getAuthStatus(ownerEmail);
  if (!requestAccountEmail) {
    return (
      status.accounts.find((account) => account.email === ownerEmail)?.email ??
      status.accounts[0]?.email ??
      ownerEmail
    );
  }
  const isOwned = status.accounts.some((a) => a.email === requestAccountEmail);
  if (!isOwned) {
    throw new ForbiddenError("Account not owned by current user");
  }
  return requestAccountEmail;
}

function handleError(event: H3Event, error: any) {
  if (error instanceof ForbiddenError) {
    setResponseStatus(event, 403);
  } else {
    setResponseStatus(event, 500);
  }
  return { error: error.message };
}

export const rsvpEvent = defineEventHandler(async (event: H3Event) => {
  try {
    const email = await uEmail(event);
    const id = getRouterParam(event, "id") as string;
    const body = await readBody(event);

    if (!id.startsWith("google-")) {
      setResponseStatus(event, 404);
      return { error: "Event not found" };
    }

    const status = body?.status;
    if (!["accepted", "declined", "tentative"].includes(status)) {
      setResponseStatus(event, 400);
      return { error: "status must be accepted, declined, or tentative" };
    }

    const googleEventId = id.replace(/^google-/, "");

    if (!(await googleCalendar.isConnected(email))) {
      setResponseStatus(event, 400);
      return { error: "Google Calendar not connected" };
    }

    const acctEmail = await resolveAccountEmail(body.accountEmail, email);

    const scope = body?.scope || "single";
    const note = typeof body?.note === "string" ? body.note.trim() : undefined;
    if (body?.note != null && typeof body.note !== "string") {
      setResponseStatus(event, 400);
      return { error: "note must be a string" };
    }
    if (note && note.length > 1000) {
      setResponseStatus(event, 400);
      return { error: "note must be 1000 characters or fewer" };
    }
    const sendUpdates = body?.sendUpdates;
    if (
      sendUpdates !== undefined &&
      sendUpdates !== "all" &&
      sendUpdates !== "none"
    ) {
      setResponseStatus(event, 400);
      return { error: "sendUpdates must be all or none" };
    }

    try {
      await googleCalendar.rsvpEvent(
        googleEventId,
        status,
        { ownerEmail: email, accountEmail: acctEmail },
        scope,
        note,
        sendUpdates,
      );
    } catch (error: any) {
      setResponseStatus(event, 500);
      return { error: `Failed to update RSVP: ${error.message}` };
    }

    return { success: true, status, note };
  } catch (error: any) {
    return handleError(event, error);
  }
});
