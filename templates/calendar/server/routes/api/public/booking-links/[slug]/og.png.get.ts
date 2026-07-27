import { getUserSetting } from "@agent-native/core/settings";
import { eq } from "drizzle-orm";
import {
  defineEventHandler,
  getMethod,
  getQuery,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { assets as serverAssets } from "#nitro/virtual/server-assets";

import type { Settings } from "../../../../../../shared/api.js";
import { getDb, schema } from "../../../../../db/index.js";
import { getBookingUsername } from "../../../../../handlers/booking-usernames.js";
import { loadBundledOgFontFiles } from "../../../../../lib/booking-og-fonts.js";
import {
  renderBookingOgImagePng,
  renderBookingOgImageSvg,
  type BookingOgImageInput,
} from "../../../../../lib/booking-og-image.js";
import { bookingOgImageResponseHeaders } from "../../../../../lib/booking-og-response.js";
import { getPrimaryAccountPhotoUrl } from "../../../../../lib/google-calendar.js";

function pngBody(bytes: Uint8Array): ArrayBuffer {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return body;
}

function textByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isResvgRuntimeUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    /@resvg\/resvg-js|resvgjs\.[\w-]+\.node|native binding/i.test(message) &&
    /cannot find|err_module_not_found|dlopen|invalid elf|wrong architecture|not a valid win32|native binding/i.test(
      message,
    )
  );
}

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

  if (getMethod(event) === "HEAD") {
    return new Response(null, {
      headers: bookingOgImageResponseHeaders(),
    });
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
  let png: Uint8Array;
  try {
    png = await renderBookingOgImagePng(
      imageInput,
      fontFiles ? { fontFiles } : {},
    );
  } catch (error) {
    if (!isResvgRuntimeUnavailableError(error)) throw error;
    const svg = renderBookingOgImageSvg(imageInput);
    return new Response(svg, {
      headers: bookingOgImageResponseHeaders(
        textByteLength(svg),
        "image/svg+xml; charset=utf-8",
      ),
    });
  }

  setResponseHeader(event, "Cross-Origin-Resource-Policy", "cross-origin");
  return new Response(pngBody(png), {
    headers: bookingOgImageResponseHeaders(png.byteLength),
  });
});
