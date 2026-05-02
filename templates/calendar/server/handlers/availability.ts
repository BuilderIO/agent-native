import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";
import { eq } from "drizzle-orm";
import type { AvailabilityConfig } from "../../shared/api.js";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import {
  readBody,
  getRequestTimezone,
  getSession,
} from "@agent-native/core/server";
import { getDb, schema } from "../db/index.js";

function createDefaultAvailability(timezone: string): AvailabilityConfig {
  return {
    timezone,
    weeklySchedule: {
      monday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
      tuesday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
      wednesday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
      thursday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
      friday: { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
      saturday: { enabled: false, slots: [] },
      sunday: { enabled: false, slots: [] },
    },
    bufferMinutes: 15,
    minNoticeHours: 24,
    maxAdvanceDays: 60,
    slotDurationMinutes: 30,
    bookingPageSlug: "book",
  };
}

async function uEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  if (!session?.email) {
    const { createError } = await import("h3");
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  return session.email;
}

export const getAvailability = defineEventHandler(async (event: H3Event) => {
  try {
    const email = await uEmail(event);
    const settings = (await getUserSetting(email, "calendar-settings")) as {
      timezone?: string;
    } | null;
    const fallbackTimezone =
      settings?.timezone || getRequestTimezone() || "America/New_York";
    const config =
      (await getUserSetting(email, "calendar-availability")) ||
      createDefaultAvailability(fallbackTimezone);
    return config;
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const getPublicAvailability = defineEventHandler(
  async (event: H3Event) => {
    const query = getQuery(event);
    const slug = typeof query.slug === "string" ? query.slug : "";
    if (slug) {
      const link = await getDb()
        .select({ ownerEmail: schema.bookingLinks.ownerEmail })
        .from(schema.bookingLinks)
        .where(eq(schema.bookingLinks.slug, slug))
        .then((rows) => rows[0]);
      if (link?.ownerEmail) {
        const ownerConfig = (await getUserSetting(
          link.ownerEmail,
          "calendar-availability",
        )) as unknown as AvailabilityConfig | null;
        if (ownerConfig) return ownerConfig;
        const ownerSettings = (await getUserSetting(
          link.ownerEmail,
          "calendar-settings",
        )) as { timezone?: string } | null;
        return createDefaultAvailability(
          ownerSettings?.timezone || "America/New_York",
        );
      }
    }

    // Fall back to defaults — never read the unscoped `calendar-availability`
    // setting. That key was historically dual-written by every user's update
    // (see the matching fix in updateAvailability), which meant a brand-new
    // user's public booking link advertised whoever last saved their hours.
    return createDefaultAvailability("America/New_York");
  },
);

export const updateAvailability = defineEventHandler(async (event: H3Event) => {
  try {
    const email = await uEmail(event);
    const config: AvailabilityConfig = await readBody(event);
    const configRecord = config as unknown as Record<string, unknown>;
    await putUserSetting(email, "calendar-availability", configRecord);
    // Do NOT also write to the deploy-wide `calendar-availability` key. The
    // earlier dual-write let every signed-in user clobber the global config —
    // a brand-new user's public booking link then surfaced the previous
    // editor's working hours/timezone. See PLAN.md / 01-data-leakage.md.
    return config;
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
