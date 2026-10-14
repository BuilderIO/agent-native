import {
  getBetterAuthUserIdForEmail,
  platformWaitUntil,
} from "@agent-native/core/server";
import {
  flushTracking,
  track,
  type TrackingSource,
} from "@agent-native/core/tracking";
import type { H3Event } from "h3";

/**
 * Track a clip funnel event keyed to the clip's creator by better-auth id, the
 * same id `signup.auth_user_id` and `referrer_user` carry. The owner lookup
 * runs after the response, never ahead of it, and nothing here throws.
 *
 * The event exists only after core's end-of-request tracking flush has run,
 * so this chain flushes the providers itself, and it is handed to the
 * platform's waitUntil (not `event.waitUntil`, which Nitro's Netlify entry
 * drops) so a frozen function cannot lose it.
 */
export function trackClipEventForOwner(
  event: H3Event,
  name: string,
  ownerEmail: string | null | undefined,
  properties: Record<string, unknown>,
  source?: TrackingSource,
): void {
  try {
    const pending = (
      ownerEmail
        ? getBetterAuthUserIdForEmail(ownerEmail)
        : Promise.resolve(undefined)
    )
      .then((ownerAuthUserId) => {
        track(
          name,
          {
            app_name: "clips",
            template_name: "clips",
            output_type: "clip",
            ...properties,
            owner_auth_user_id: ownerAuthUserId,
          },
          source,
        );
        return flushTracking();
      })
      .catch((err) => {
        console.warn(`[clips] ${name} track failed:`, err);
      });
    platformWaitUntil(event.req)?.(pending);
  } catch (err) {
    console.warn(`[clips] ${name} track failed:`, err);
  }
}
