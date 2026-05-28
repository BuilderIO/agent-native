import {
  defineEventHandler,
  getQuery,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";
import { eq } from "drizzle-orm";
import { getUserSetting } from "@agent-native/core/settings";
import { getDb, schema } from "../../../../../db/index.js";
import { getBookingUsername } from "../../../../../handlers/booking-usernames.js";
import {
  renderBookingOgImagePng,
  type BookingOgImageInput,
} from "../../../../../lib/booking-og-image.js";
import type { Settings } from "../../../../../../shared/api.js";

function parseDurations(value: string | null): number[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return undefined;
    return parsed
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0);
  } catch {
    return undefined;
  }
}

export default defineEventHandler(async (event: H3Event) => {
  const slug = getRouterParam(event, "slug");
  if (!slug) {
    setResponseStatus(event, 400);
    return { error: "slug is required" };
  }

  const [bookingLink] = await getDb()
    .select()
    .from(schema.bookingLinks)
    .where(eq(schema.bookingLinks.slug, slug))
    .limit(1);

  if (!bookingLink?.isActive) {
    setResponseStatus(event, 404);
    return { error: "Booking link not found" };
  }

  const query = getQuery(event);
  const queryUsername =
    typeof query.username === "string" ? query.username : undefined;
  const [ownerSettings, reservedUsername] = await Promise.all([
    getUserSetting(
      bookingLink.ownerEmail,
      "calendar-settings",
    ) as Promise<Settings | null>,
    getBookingUsername(bookingLink.ownerEmail),
  ]);
  const imageInput: BookingOgImageInput = {
    title: bookingLink.title,
    description: bookingLink.description,
    duration: bookingLink.duration,
    durations: parseDurations(bookingLink.durations),
    username: queryUsername || reservedUsername,
    ownerEmail: bookingLink.ownerEmail,
    bookingPageTitle: ownerSettings?.bookingPageTitle,
  };
  const png = renderBookingOgImagePng(imageInput);

  setResponseHeader(event, "Content-Type", "image/png");
  setResponseHeader(event, "Content-Length", String(png.byteLength));
  setResponseHeader(
    event,
    "Cache-Control",
    "public, max-age=300, stale-while-revalidate=86400",
  );
  return Buffer.from(png);
});
