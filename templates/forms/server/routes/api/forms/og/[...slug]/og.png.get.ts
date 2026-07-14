import { agentNativeOgImageResponseHeaders } from "@agent-native/core/server";
import { getSetting } from "@agent-native/core/settings";
import {
  defineEventHandler,
  getMethod,
  getRequestURL,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  renderFormOgImagePng,
  renderFormOgImageSvg,
} from "../../../../../lib/form-og-image.js";
import { getPublicFormBySlugOrId } from "../../../../../lib/public-form-ssr.js";

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
    /cannot find|no such module|err_module_not_found|dlopen|invalid elf|wrong architecture|not a valid win32|native binding/i.test(
      message,
    )
  );
}

const AVATAR_DATA_URL_RE =
  /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;

function validAvatarDataUrl(value: string): string | undefined {
  const image = value.trim();
  return image.length <= 2_000_000 && AVATAR_DATA_URL_RE.test(image)
    ? image
    : undefined;
}

function normalizeGoogleProfilePhotoUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !/(^|\.)googleusercontent\.com$/i.test(url.hostname)
    ) {
      return undefined;
    }
    return url.toString().replace(/=s\d+(-c)?$/i, "=s256-c");
  } catch {
    return undefined;
  }
}

async function fetchGoogleProfilePhotoDataUrl(
  photoUrl: string,
): Promise<string | undefined> {
  const url = normalizeGoogleProfilePhotoUrl(photoUrl);
  if (!url) return undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Agent-Native Forms OG Image" },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;

    const contentType =
      response.headers.get("content-type")?.split(";")[0]?.trim() || "";
    if (!/^image\/(?:png|jpe?g|gif|webp)$/i.test(contentType)) {
      return undefined;
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 2_000_000) {
      return undefined;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 2_000_000) return undefined;
    return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadProfileImageDataUrl(
  ownerEmail: string | null | undefined,
): Promise<string | undefined> {
  if (!ownerEmail) return undefined;
  try {
    const avatar = await getSetting(`avatar:${ownerEmail}`);
    if (typeof avatar?.image !== "string") return undefined;
    return (
      validAvatarDataUrl(avatar.image) ??
      (await fetchGoogleProfilePhotoDataUrl(avatar.image))
    );
  } catch {
    return undefined;
  }
}

export function formSlugFromOgPath(pathname: string): string {
  const marker = "/api/forms/og/";
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex < 0) return "";

  const tail = pathname.slice(markerIndex + marker.length);
  const suffix = "/og.png";
  if (!tail.endsWith(suffix)) return "";

  try {
    return decodeURIComponent(tail.slice(0, -suffix.length));
  } catch {
    return "";
  }
}

export default defineEventHandler(async (event: H3Event) => {
  const slug =
    formSlugFromOgPath(getRequestURL(event).pathname) ||
    (() => {
      const param = getRouterParam(event, "slug");
      if (!param) return "";
      try {
        return decodeURIComponent(param);
      } catch {
        return "";
      }
    })();
  if (!slug) {
    setResponseStatus(event, 400);
    return { error: "slug is required" };
  }

  const form = await getPublicFormBySlugOrId(slug);
  if (!form) {
    setResponseStatus(event, 404);
    return { error: "Form not found" };
  }

  if (getMethod(event) === "HEAD") {
    return new Response(null, {
      headers: agentNativeOgImageResponseHeaders(0),
    });
  }

  const profileImageDataUrl = await loadProfileImageDataUrl(form.ownerEmail);
  const imageInput = {
    title: form.title,
    description: form.description,
    profileImageDataUrl,
  };

  let png: Uint8Array;
  try {
    png = await renderFormOgImagePng(imageInput);
  } catch (error) {
    if (!isResvgRuntimeUnavailableError(error)) throw error;
    const svg = renderFormOgImageSvg(imageInput);
    return new Response(svg, {
      headers: agentNativeOgImageResponseHeaders(
        textByteLength(svg),
        "image/svg+xml; charset=utf-8",
      ),
    });
  }

  return new Response(pngBody(png), {
    headers: agentNativeOgImageResponseHeaders(png.byteLength),
  });
});
