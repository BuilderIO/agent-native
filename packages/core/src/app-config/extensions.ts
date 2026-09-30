import { z } from "zod";

/**
 * SECURITY — these values are interpolated into the sandboxed extension
 * iframe's Content-Security-Policy. A source expression is validated as a
 * single token with no whitespace or `;`, so a configured value can extend
 * `img-src` / `media-src` but can never terminate the directive and append a
 * new one. `connect-src` is not configurable and stays `'self'`. A remote
 * `img-src` / `media-src` origin is still an explicit egress permission:
 * the browser requests that URL, so extension script can encode data into
 * it. The host bridge is the permission-gated path for API calls, not a
 * claim that these sources are egress-free.
 */
const cspSource = z
  .string()
  .regex(
    /^(?:'self'|'none'|(?:https?|data|blob|mediastream):|https?:\/\/(?:\*\.)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*(?::\d{1,5})?)$/,
    "must be one CSP source expression: 'self', 'none', a scheme such as https: or blob:, or an http(s) origin such as https://cdn.example.com",
  );

/**
 * What the extension iframe loads when a deployment has not narrowed or
 * widened img-src / media-src. The iframe shell builds its default CSP
 * from this same list, so the declared default and the shipped policy
 * cannot drift apart.
 */
export const DEFAULT_EXTENSION_DISPLAY_SOURCES = ["'self'", "data:", "blob:"];

function displaySources(doc: string) {
  return z
    .array(cspSource)
    .min(1)
    .default(DEFAULT_EXTENSION_DISPLAY_SOURCES)
    .meta({ doc });
}

export const extensionsConfig = z.object({
  iframeImageSources: displaySources(
    "Replaces the image sources the sandboxed extension iframe may load. Defaults to 'self' data: blob:, which blocks every remote image; add https: or one origin to show product photos, avatars, or CDN assets. Every allowed remote origin is an explicit egress permission: the browser requests that URL. connect-src stays 'self'.",
  ).meta({ env: "AGENT_NATIVE_EXTENSION_IFRAME_IMAGE_SOURCES" }),
  iframeMediaSources: displaySources(
    "Replaces the media sources the sandboxed extension iframe may load, with the same syntax and the same default as `extensions.iframeImageSources`. A remote entry is an explicit egress permission: the browser requests that URL.",
  ).meta({ env: "AGENT_NATIVE_EXTENSION_IFRAME_MEDIA_SOURCES" }),
});
