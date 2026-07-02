import { agentNativeOgImageResponseHeaders } from "@agent-native/core/server";
import {
  defineEventHandler,
  getMethod,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";

import { renderFormOgImagePng } from "../../../../../lib/form-og-image.js";
import { getPublicFormBySlugOrId } from "../../../../../lib/public-form-ssr.js";

function pngBody(bytes: Uint8Array): ArrayBuffer {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return body;
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

  const png = await renderFormOgImagePng({
    title: form.title,
  });

  return new Response(pngBody(png), {
    headers: agentNativeOgImageResponseHeaders(png.byteLength),
  });
});
