import {
  defineEventHandler,
  getMethod,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import {
  agentNativeOgImageResponseHeaders,
  renderAgentNativeOgImagePng,
} from "@agent-native/core/server";
import { getPublicFormBySlugOrId } from "../../../../../lib/public-form-ssr.js";

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

  const png = await renderAgentNativeOgImagePng({
    appName: "Agent-Native Forms",
    title: form.title,
    subtitle: "Agent-Native Forms",
  });
  const body = png.buffer.slice(
    png.byteOffset,
    png.byteOffset + png.byteLength,
  ) as ArrayBuffer;

  return new Response(getMethod(event) === "HEAD" ? null : body, {
    headers: agentNativeOgImageResponseHeaders(png.byteLength),
  });
});
