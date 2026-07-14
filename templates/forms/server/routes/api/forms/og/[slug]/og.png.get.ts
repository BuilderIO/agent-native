import { agentNativeOgImageResponseHeaders } from "@agent-native/core/server";
import { getSetting } from "@agent-native/core/settings";
import {
  defineEventHandler,
  getMethod,
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

async function loadProfileImageDataUrl(
  ownerEmail: string | null | undefined,
): Promise<string | undefined> {
  if (!ownerEmail) return undefined;
  try {
    const avatar = await getSetting(`avatar:${ownerEmail}`);
    return typeof avatar?.image === "string" ? avatar.image : undefined;
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
