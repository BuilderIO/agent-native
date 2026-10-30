import { appApiPath } from "@agent-native/core/client/api-path";
import { privateMediaIdFromSrc } from "@shared/private-media";

/**
 * Where the browser loads an image from. Bodies store private images as
 * `/api/private-media/<id>` without the app's base path; this adds it. Any
 * other source is returned as is.
 */
export function imageDisplaySrc(src: string): string {
  return privateMediaIdFromSrc(src) ? appApiPath(src) : src;
}
