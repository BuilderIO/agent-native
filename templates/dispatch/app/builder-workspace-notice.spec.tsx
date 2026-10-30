// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: mocks.useSession,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
import { BuilderWorkspaceNotice } from "./builder-workspace-notice";

describe("Builder workspace notice", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [
      "beta.dispatch.agent-native.com",
      "person@builder.io",
      "https://beta.agent-workspace.builder.io",
    ],
    [
      "dispatch.agent-native.com",
      "person@builder.io",
      "https://agent-workspace.builder.io",
    ],
    ["beta.agent-workspace.builder.io", "person@builder.io", null],
    ["beta.dispatch.agent-native.com", "person@example.com", null],
    ["beta.dispatch.agent-native.com.evil.test", "person@builder.io", null],
  ])(
    "offers the appropriate workspace on %s for %s",
    (hostname, email, target) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      vi.stubGlobal("window", { location: { hostname } });
      mocks.useSession.mockReturnValue({
        status: "authenticated",
        session: { email },
      });
      const container = document.createElement("div");
      const root = createRoot(container);
      act(() => root.render(<BuilderWorkspaceNotice />));
      expect(container.querySelector("a")?.getAttribute("href") ?? null).toBe(
        target,
      );
      act(() => root.unmount());
    },
  );
});
