import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetch as expoFetch } from "expo/fetch";

import { getSessionToken } from "@/lib/session-token-store";

const ANALYTICS_SESSION_KEY = "agent-native.analytics.session";
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export const MOBILE_ANALYTICS_PLATFORM = "mobile" as const;
export const MOBILE_ANALYTICS_PLATFORM_HEADER =
  "X-Agent-Native-Client-Platform";

const chatApp = TEMPLATE_APPS.find((app) => app.id === "chat");
export const DEFAULT_MOBILE_ANALYTICS_BASE_URL =
  chatApp?.url ?? "https://chat.agent-native.com";

type StoredSession = {
  id: string;
  lastSeenAt: number;
};

let analyticsIdentityRequest: Promise<string> | null = null;

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

async function loadAnalyticsSessionId(): Promise<string> {
  const now = Date.now();
  const storedSession = await AsyncStorage.getItem(ANALYTICS_SESSION_KEY);

  let session: StoredSession | null = null;
  if (storedSession) {
    try {
      const parsed = JSON.parse(storedSession) as Partial<StoredSession>;
      if (
        typeof parsed.id === "string" &&
        typeof parsed.lastSeenAt === "number" &&
        now - parsed.lastSeenAt < SESSION_IDLE_TIMEOUT_MS
      ) {
        session = { id: parsed.id, lastSeenAt: parsed.lastSeenAt };
      }
    } catch {
      // Start a new session when persisted analytics state is unreadable.
    }
  }

  const sessionId = session?.id ?? createId("session");
  await AsyncStorage.setItem(
    ANALYTICS_SESSION_KEY,
    JSON.stringify({ id: sessionId, lastSeenAt: now } satisfies StoredSession),
  );

  return sessionId;
}

function getOrCreateAnalyticsSessionId(): Promise<string> {
  if (analyticsIdentityRequest) return analyticsIdentityRequest;
  const request = loadAnalyticsSessionId();
  analyticsIdentityRequest = request;
  void request.then(
    () => {
      if (analyticsIdentityRequest === request) analyticsIdentityRequest = null;
    },
    () => {
      if (analyticsIdentityRequest === request) analyticsIdentityRequest = null;
    },
  );
  return request;
}

export async function getMobileAnalyticsHeaders(): Promise<
  Record<string, string>
> {
  try {
    const sessionId = await getOrCreateAnalyticsSessionId();
    return {
      [MOBILE_ANALYTICS_PLATFORM_HEADER]: MOBILE_ANALYTICS_PLATFORM,
      "X-Agent-Native-Session-Id": sessionId,
    };
  } catch {
    return {
      [MOBILE_ANALYTICS_PLATFORM_HEADER]: MOBILE_ANALYTICS_PLATFORM,
    };
  }
}

/**
 * Send a content-free event through the app's authenticated server-side
 * analytics providers. Native mobile does not have the browser analytics
 * runtime, so this keeps attribution on the same first-party route.
 */
export async function trackMobileEvent(
  name: string,
  properties: Record<string, unknown> = {},
  baseUrl = DEFAULT_MOBILE_ANALYTICS_BASE_URL,
): Promise<void> {
  if (!name.trim()) return;

  try {
    const token = await getSessionToken();
    if (!token) return;

    const sessionId = await getOrCreateAnalyticsSessionId();
    await expoFetch(`${baseUrl.replace(/\/+$/, "")}/_agent-native/track`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Agent-Native-CSRF": "1",
        [MOBILE_ANALYTICS_PLATFORM_HEADER]: MOBILE_ANALYTICS_PLATFORM,
        "X-Agent-Native-Session-Id": sessionId,
      },
      body: JSON.stringify({
        name,
        properties: {
          ...properties,
          client_platform: MOBILE_ANALYTICS_PLATFORM,
        },
      }),
    });
  } catch {
    // Analytics must never interrupt navigation or a chat turn.
  }
}
