// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    error: new Error("unavailable"),
    isLoading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/toolkit/app/settings", () => ({
  SettingsGroup: ({ children }: { children: ReactNode }) =>
    createElement("section", null, children),
}));
vi.mock("./AnalyticsWorkspaceName", () => ({
  AnalyticsWorkspaceName: () => null,
}));
import { AnalyticsPreferencesPage } from "./AnalyticsPreferencesPage";
it("shows a failed formatting read instead of inventing default success", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(AnalyticsPreferencesPage)));
    expect(host.querySelector("[role=alert]")?.textContent).toContain(
      "loadError",
    );
    expect(host.textContent).not.toContain("upper");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
