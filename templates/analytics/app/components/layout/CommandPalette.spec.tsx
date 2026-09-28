// @vitest-environment happy-dom

import { getSettingsShortcutHint } from "@agent-native/core/client/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isMacPlatform } from "@/lib/utils";

const mocks = vi.hoisted(() => ({
  openSettingsPage: vi.fn(),
  redesign: false,
}));

vi.mock("@agent-native/core/client/navigation", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/navigation")
  >()),
  openSettingsPage: mocks.openSettingsPage,
}));
vi.mock("@agent-native/core/client/changelog", () => ({
  ChangelogDialog: () => null,
}));
vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlagState: () => ({ enabled: mocks.redesign }),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(async () => []),
  useChangeVersions: () => 0,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    key === "settingsShortcut.command" ? "Settings" : key,
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrgRole: () => ({
    canManageOrg: false,
    isOwner: false,
    org: undefined,
    role: null,
  }),
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ auth: null }),
}));
vi.mock("@/hooks/use-replay-storage-status", () => ({
  useReplayStorageStatus: () => ({ data: undefined }),
}));
vi.mock("@/pages/adhoc/registry", () => ({ dashboards: [] }));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}));
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../../../CHANGELOG.md?raw", () => ({ default: "" }));

import { CommandPalette } from "./CommandPalette";

function commandItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[cmdk-item]"));
}

describe("CommandPalette Settings command", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.openSettingsPage.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  async function openPalette() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CommandPalette />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
      );
    });
  }

  for (const redesign of [false, true]) {
    it(`lists Settings with its shortcut before any search (redesign ${redesign ? "on" : "off"})`, async () => {
      mocks.redesign = redesign;
      await openPalette();

      const settings = commandItems().find((item) =>
        /^\s*Settings/.test(item.textContent ?? ""),
      );
      expect(settings).toBeDefined();
      expect(settings?.textContent).toContain(
        getSettingsShortcutHint(isMacPlatform()),
      );

      await act(async () => {
        settings?.click();
      });
      expect(mocks.openSettingsPage).toHaveBeenCalledTimes(1);
    });
  }
});
