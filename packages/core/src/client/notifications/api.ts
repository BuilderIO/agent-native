import type { PersonalNotificationRouting } from "../../notifications/routing.js";
import type { Notification } from "../../notifications/types.js";
import { agentNativePath } from "../api-path.js";

export class NotificationRoutingClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "NotificationRoutingClientError";
  }
}

export async function getPersonalNotificationRouting(
  signal?: AbortSignal,
): Promise<PersonalNotificationRouting> {
  return notificationRequest(
    "/_agent-native/notifications/routing",
    undefined,
    signal,
  );
}

export async function updatePersonalNotificationRouting(
  routing: PersonalNotificationRouting,
  signal?: AbortSignal,
): Promise<PersonalNotificationRouting> {
  return notificationRequest(
    "/_agent-native/notifications/routing",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(routing),
    },
    signal,
  );
}

export async function listClientNotifications(
  options: { unreadOnly?: boolean; limit?: number } = {},
  signal?: AbortSignal,
): Promise<Notification[]> {
  const query = new URLSearchParams();
  if (options.unreadOnly) query.set("unread", "true");
  if (options.limit) query.set("limit", String(options.limit));
  const suffix = query.size ? `?${query}` : "";
  return notificationRequest(
    `/_agent-native/notifications${suffix}`,
    undefined,
    signal,
  );
}

export async function countClientUnreadNotifications(
  signal?: AbortSignal,
): Promise<number> {
  const result = await notificationRequest<{ count: number }>(
    "/_agent-native/notifications/count",
    undefined,
    signal,
  );
  return result.count;
}

export async function markClientNotificationRead(id: string): Promise<void> {
  await notificationRequest(
    `/_agent-native/notifications/${encodeURIComponent(id)}/read`,
    { method: "POST", keepalive: true },
  );
}

export async function markAllClientNotificationsRead(): Promise<void> {
  await notificationRequest("/_agent-native/notifications/read-all", {
    method: "POST",
  });
}

export async function dismissClientNotification(id: string): Promise<void> {
  await notificationRequest(
    `/_agent-native/notifications/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

async function notificationRequest<T>(
  path: string,
  init?: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(agentNativePath(path), { ...init, signal });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new NotificationRoutingClientError(
      response.ok
        ? "Notification routing response was not valid JSON."
        : response.statusText || `Request failed (HTTP ${response.status})`,
      response.status,
    );
  }
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : response.statusText || `Request failed (HTTP ${response.status})`;
    throw new NotificationRoutingClientError(message, response.status);
  }
  return payload as T;
}
