/**
 * Cal Video (Daily.co) provider — zero-OAuth video provider driven by a
 * server-to-server API key. Creates a Daily.co room per booking.
 */
import type { VideoProvider } from "./types.js";

export interface DailyVideoProviderConfig {
  apiKey: string;
  /** Prefix for Daily room names; defaults to "cal-" */
  roomPrefix?: string;
}

export function createDailyVideoProvider(
  config: DailyVideoProviderConfig,
): VideoProvider {
  const prefix = config.roomPrefix ?? "cal-";
  async function apiCall<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`https://api.daily.co/v1${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`Daily.co ${res.status}: ${await res.text()}`);
    }
    if (res.status === 204) return undefined as unknown as T;
    return (await res.json()) as T;
  }
  return {
    kind: "cal_video",
    label: "Cal Video",
    async createMeeting({ booking }) {
      const roomName = `${prefix}${booking.uid}`.slice(0, 40);
      const resp = await apiCall<{ url: string; name: string }>("/rooms", {
        method: "POST",
        body: JSON.stringify({
          name: roomName,
          properties: {
            nbf: Math.floor(new Date(booking.startTime).getTime() / 1000),
            exp: Math.floor(new Date(booking.endTime).getTime() / 1000) + 3600,
            enable_prejoin_ui: true,
            enable_chat: true,
            enable_knocking: true,
            eject_at_room_exp: true,
          },
        }),
      });
      return {
        meetingUrl: resp.url,
        meetingId: resp.name,
      };
    },
    async deleteMeeting({ meetingId }) {
      await apiCall(`/rooms/${encodeURIComponent(meetingId)}`, {
        method: "DELETE",
      });
    },
  };
}
