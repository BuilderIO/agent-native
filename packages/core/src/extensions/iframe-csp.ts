import { getAppConfig } from "../app-config/index.js";
import {
  EXTENSION_FRAME_ANCESTORS,
  extensionIframeCspBase,
} from "./html-shell.js";

/**
 * Server-only: resolves `extensions.iframeImageSources` /
 * `extensions.iframeMediaSources` from app config. Kept out of
 * `html-shell.ts` because that shell is also built in the browser, where the
 * app-config store must not be imported.
 */
export function buildExtensionIframeMetaCsp(): string {
  const { iframeImageSources, iframeMediaSources } = getAppConfig().extensions;
  return extensionIframeCspBase(iframeImageSources, iframeMediaSources);
}

/** The header CSP the render route sets: the meta CSP plus `frame-ancestors`. */
export function buildExtensionIframeCsp(): string {
  return `${buildExtensionIframeMetaCsp()} frame-ancestors ${EXTENSION_FRAME_ANCESTORS};`;
}
