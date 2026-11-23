// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  admin: true,
  loadError: false,
  loading: false,
  retry: vi.fn(),
  call: vi.fn(),
  sharing: {
    settings: {
      allowPublicSharing: false,
      allowWorkspaceSharing: true,
      allowGuestCreation: false,
    },
    capabilities: {
      publicSharingSupported: false,
      guestSharingSupported: false,
    },
    canEdit: true,
  },
}));

vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  callAction: state.call,
  useActionQuery: (name: string) => ({
    data:
      name === "get-workspace-bootstrap"
        ? { features: { isAdmin: state.admin } }
        : name === "get-organization-sharing-settings"
          ? state.loadError || state.loading
            ? undefined
            : { ...state.sharing, canEdit: state.admin }
          : undefined,
    isLoading:
      name === "get-organization-sharing-settings" ? state.loading : false,
    isError:
      name === "get-organization-sharing-settings" ? state.loadError : false,
    refetch: state.retry,
  }),
}));

vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  ...(await import("@/skins/reference/testing/i18n")).i18nMock,
}));

import { AnalyticsSharingSettingsPage } from "./AnalyticsGitAndSharingPages";

describe("row 464 AnalyticsSharingSettingsPage", () => {
  beforeEach(() => {
    state.admin = true;
    state.loadError = false;
    state.loading = false;
    state.sharing = {
      settings: {
        allowPublicSharing: false,
        allowWorkspaceSharing: true,
        allowGuestCreation: false,
      },
      capabilities: {
        publicSharingSupported: false,
        guestSharingSupported: false,
      },
      canEdit: true,
    };
    state.retry.mockReset();
    state.call.mockReset();
    state.call.mockResolvedValue(state.sharing);
  });

  const mount = () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={["/settings/sharing"]}>
            <AnalyticsSharingSettingsPage />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    return {
      host,
      close: () => {
        act(() => root.unmount());
        host.remove();
      },
    };
  };

  it("renders real toggle controls for web, workspace, and guest sharing policies", () => {
    const { host, close } = mount();
    try {
      const toggles = Array.from(
        host.querySelectorAll<HTMLElement>(
          "[role=switch], input[type=checkbox]",
        ),
      );
      expect(toggles).toHaveLength(3);
      expect(host.textContent).toContain("Share projects to web");
      expect(host.textContent).toContain("Share projects with workspace");
      expect(host.textContent).toContain(
        "Allow projects to be shared with guests",
      );
      const usersLink = host.querySelector<HTMLAnchorElement>(
        'a[href="/settings/users"]',
      );
      expect(usersLink?.textContent).toContain("Manage users");
    } finally {
      close();
    }
  });

  it("persists toggling workspace sharing through save-organization-sharing-settings", async () => {
    const { host, close } = mount();
    try {
      const workspaceToggle = Array.from(
        host.querySelectorAll<HTMLElement>(
          "[role=switch], input[type=checkbox]",
        ),
      ).find((el) => /workspace/i.test(el.getAttribute("aria-label") ?? ""));
      expect(workspaceToggle).toBeTruthy();
      expect(workspaceToggle?.hasAttribute("disabled")).toBe(false);
      await act(async () => workspaceToggle?.click());
      expect(state.call).toHaveBeenCalledWith(
        "save-organization-sharing-settings",
        {
          allowPublicSharing: false,
          allowWorkspaceSharing: false,
          allowGuestCreation: false,
        },
      );
    } finally {
      close();
    }
  });

  it("keeps unsupported web and guest sharing toggles disabled with honest status", () => {
    const { host, close } = mount();
    try {
      const toggles = Array.from(
        host.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
          "[role=switch], input[type=checkbox]",
        ),
      );
      const webToggle = toggles.find((el) =>
        /web/i.test(el.getAttribute("aria-label") ?? ""),
      );
      const guestToggle = toggles.find((el) =>
        /guest/i.test(el.getAttribute("aria-label") ?? ""),
      );
      expect(
        webToggle?.disabled ||
          webToggle?.getAttribute("aria-disabled") === "true",
      ).toBe(true);
      expect(
        guestToggle?.disabled ||
          guestToggle?.getAttribute("aria-disabled") === "true",
      ).toBe(true);
    } finally {
      close();
    }
  });

  it("disables workspace sharing edits for non-admin members", () => {
    state.admin = false;
    const { host, close } = mount();
    try {
      const toggles = Array.from(
        host.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
          "[role=switch], input[type=checkbox]",
        ),
      );
      expect(toggles).toHaveLength(3);
      for (const toggle of toggles) {
        expect(
          toggle.disabled || toggle.getAttribute("aria-disabled") === "true",
        ).toBe(true);
      }
    } finally {
      close();
    }
  });

  it("shows a retry alert when sharing settings fail to load", () => {
    state.loadError = true;
    const { host, close } = mount();
    try {
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
      const retry = Array.from(host.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Retry",
      );
      expect(retry).toBeDefined();
      act(() => retry?.click());
      expect(state.retry).toHaveBeenCalledOnce();
    } finally {
      close();
    }
  });

  it("shows an error when saving workspace sharing fails", async () => {
    state.call.mockRejectedValueOnce(new Error("Save failed"));
    const { host, close } = mount();
    try {
      const workspaceToggle = Array.from(
        host.querySelectorAll<HTMLElement>(
          "[role=switch], input[type=checkbox]",
        ),
      ).find((el) => /workspace/i.test(el.getAttribute("aria-label") ?? ""));
      expect(workspaceToggle).toBeTruthy();
      await act(async () => workspaceToggle?.click());
      expect(host.textContent).toContain(
        "Could not save sharing settings. Try again.",
      );
    } finally {
      close();
    }
  });
});
