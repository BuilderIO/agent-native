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
import { assets as serverAssets } from "#nitro/virtual/server-assets";
import { getDb, schema } from "../../../../../db/index.js";
import { getBookingUsername } from "../../../../../handlers/booking-usernames.js";
import { loadBundledOgFontFiles } from "../../../../../lib/booking-og-fonts.js";
import { getPrimaryAccountPhotoUrl } from "../../../../../lib/google-calendar.js";
import { bookingOgImageResponseHeaders } from "../../../../../lib/booking-og-response.js";
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

function normalizeGoogleProfilePhotoUrl(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "";
    if (!/(^|\.)googleusercontent\.com$/i.test(url.hostname)) return "";
    return url.toString().replace(/=s\d+(-c)?$/i, "=s256-c");
  } catch {
    return "";
  }
}

async function fetchProfileImageDataUrl(
  photoUrl: string | undefined,
): Promise<string | undefined> {
  const url = normalizeGoogleProfilePhotoUrl(photoUrl);
  if (!url) return undefined;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Agent-Native Calendar OG Image" },
    });
    if (!response.ok) return undefined;

    const contentType =
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
      "image/jpeg";
    if (!contentType.startsWith("image/")) return undefined;

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 2_000_000) {
      return undefined;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 2_000_000) return undefined;
    return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
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

  // guard:allow-unscoped — public booking OG image, gated by active booking slug
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
  const [ownerSettings, reservedUsername, profilePhotoUrl] = await Promise.all([
    getUserSetting(bookingLink.ownerEmail, "calendar-settings").then(
      (settings) => settings as unknown as Settings | null,
    ),
    getBookingUsername(bookingLink.ownerEmail),
    getPrimaryAccountPhotoUrl(bookingLink.ownerEmail),
  ]);
  const profileImageDataUrl = await fetchProfileImageDataUrl(profilePhotoUrl);
  const imageInput: BookingOgImageInput = {
    title: bookingLink.title,
    description: bookingLink.description,
    duration: bookingLink.duration,
    durations: parseDurations(bookingLink.durations),
    username: queryUsername || reservedUsername,
    ownerEmail: bookingLink.ownerEmail,
    bookingPageTitle: ownerSettings?.bookingPageTitle,
    profileImageDataUrl,
  };
  const fontFiles = await loadBundledOgFontFiles(serverAssets);
  const png = await renderBookingOgImagePng(
    imageInput,
    fontFiles ? { fontFiles } : {},
  );
  const body = png.buffer.slice(
    png.byteOffset,
    png.byteOffset + png.byteLength,
  ) as ArrayBuffer;

  setResponseHeader(event, "Cross-Origin-Resource-Policy", "cross-origin");
  return new Response(body, {
    headers: bookingOgImageResponseHeaders(png.byteLength),
  });
});
