import { invoke } from "@tauri-apps/api/core";

export interface DismissibleMeetingNotification {
  type: "calendar" | "adhoc";
  meetingId: string;
  joinUrl?: string | null;
  platform?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
}

type NativeInvoke = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export async function dismissMeetingNotification(
  notification: DismissibleMeetingNotification,
  nativeInvoke: NativeInvoke = invoke,
): Promise<void> {
  try {
    await nativeInvoke("dismiss_meeting_notification", {
      meetingId: notification.meetingId,
      notificationType: notification.type,
      joinUrl: notification.joinUrl ?? null,
      platform: notification.platform ?? null,
      scheduledStart: notification.scheduledStart ?? null,
      scheduledEnd: notification.scheduledEnd ?? null,
    });
  } catch (error) {
    console.warn("[clips-meeting-notif] dismissal sync failed", error);
  }
}
