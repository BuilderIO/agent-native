import { describe, expect, it, vi } from "vitest";

vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("react-native", () => ({
  DeviceEventEmitter: { emit: vi.fn() },
}));
vi.mock("@/lib/analytics", () => ({
  getMobileAnalyticsHeaders: vi.fn(async () => ({})),
}));
vi.mock("@/lib/session-token-store", () => ({
  getSessionToken: vi.fn(async () => "test-token"),
}));

import { visibleTemplates } from "@agent-native/shared-app-config";

import { chatCapableApps } from "./api";

describe("chatCapableApps", () => {
  it("includes only visible templates with a production chat URL", () => {
    const expectedIds = visibleTemplates()
      .filter((template) => Boolean(template.prodUrl))
      .map((template) => template.name);

    expect(chatCapableApps().map((app) => app.id)).toEqual(expectedIds);
    expect(chatCapableApps().map((app) => app.id)).not.toContain("slides-2");
  });
});
