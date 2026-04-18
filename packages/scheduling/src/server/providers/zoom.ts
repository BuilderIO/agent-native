/**
 * Zoom provider — OAuth-based; creates a Zoom meeting per booking.
 *
 * Tokens are stored via the consumer's callback (typically core's
 * oauth_tokens), keyed by credentialId.
 */
import type { VideoProvider } from "./types.js";

export interface ZoomProviderConfig {
  clientId: string;
  clientSecret: string;
  getAccessToken: (credentialId: string) => Promise<string>;
}

export function createZoomProvider(config: ZoomProviderConfig): VideoProvider {
  return {
    kind: "zoom_video",
    label: "Zoom",
    async createMeeting({ credentialId, booking }) {
      if (!credentialId) throw new Error("Zoom requires credentialId");
      const token = await config.getAccessToken(credentialId);
      const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          topic: booking.title,
          type: 2,
          start_time: booking.startTime,
          duration: Math.round(
            (new Date(booking.endTime).getTime() -
              new Date(booking.startTime).getTime()) /
              60000,
          ),
          timezone: booking.timezone,
          settings: {
            join_before_host: true,
            waiting_room: false,
            mute_upon_entry: false,
          },
        }),
      });
      if (!res.ok) throw new Error(`Zoom ${res.status}: ${await res.text()}`);
      const body = await res.json();
      return {
        meetingUrl: body.join_url,
        meetingId: String(body.id),
        meetingPassword: body.password,
      };
    },
    async deleteMeeting({ credentialId, meetingId }) {
      if (!credentialId) return;
      const token = await config.getAccessToken(credentialId);
      await fetch(
        `https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
        },
      );
    },
  };
}
