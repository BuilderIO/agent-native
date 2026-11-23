// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import messages from "../../i18n/en-US";
import { AnalyticsPreferencesPage } from "./AnalyticsPreferencesPage";

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  actionErrorMessage: () => undefined,
  useActionQuery: () => ({ isLoading: true }),
  useActionMutation: () => ({ isPending: false }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => {
    let value: unknown = messages;
    for (const part of key.split(".")) {
      value =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[part]
          : undefined;
    }
    return typeof value === "string" ? value : key;
  },
}));

describe("workspace General page introduction", () => {
  it("keeps the workspace introduction distinct from personal preferences while loading", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      act(() => root.render(<AnalyticsPreferencesPage />));
      expect(container.textContent).toContain(
        "Manage general settings for the workspace.",
      );
      expect(container.textContent).not.toContain(
        "Manage your user preferences.",
      );
      expect(
        container.querySelector(
          "[aria-label='Loading formatting preferences']",
        ),
      ).not.toBeNull();
      const introduction = [...container.querySelectorAll("p")].find(
        (node) =>
          node.textContent === "Manage general settings for the workspace.",
      );
      expect(introduction).toBeDefined();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
