import {
  normalizeAnalyticsClientPlatform,
  type AnalyticsClientPlatform,
} from "../shared/analytics-platform.js";

type AnalyticsPlatformWindow = Window & {
  __AGENT_NATIVE_CONFIG__?: {
    clientPlatform?: unknown;
  };
  __AGENT_NATIVE_HOST_PLATFORM__?: unknown;
  agentNativeDesktop?: {
    analytics?: {
      clientPlatform?: unknown;
    };
  };
};

export function getAnalyticsClientPlatform(
  configured?: AnalyticsClientPlatform,
): AnalyticsClientPlatform {
  if (configured) return configured;
  if (typeof window === "undefined") return "web";

  const platformWindow = window as AnalyticsPlatformWindow;
  return (
    normalizeAnalyticsClientPlatform(
      platformWindow.agentNativeDesktop?.analytics?.clientPlatform,
    ) ??
    normalizeAnalyticsClientPlatform(
      platformWindow.__AGENT_NATIVE_HOST_PLATFORM__,
    ) ??
    normalizeAnalyticsClientPlatform(
      platformWindow.__AGENT_NATIVE_CONFIG__?.clientPlatform,
    ) ??
    "web"
  );
}
