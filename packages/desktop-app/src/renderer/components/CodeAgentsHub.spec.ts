// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import {
  getDesktopVisibleApps,
  isDesktopAppVisible,
} from "@shared/app-registry";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MultiFrontierIpcEvent } from "../../../shared/multi-frontier-ipc.js";
import {
  chatFirstAppSurfaceTab,
  chatFirstPreviewPartitionKey,
  dispatchControlPlaneUrlParams,
  dispatchControlPlaneTitle,
  filterDesktopApps,
  mergeDesktopAppLists,
  isDispatchControlPlanePath,
  isChatFirstSurfaceTabActive,
  orderDesktopApps,
  MultiFrontierModeControl,
} from "./CodeAgentsHub.js";
import {
  initialMultiFrontierRunAutoContinue,
  locksMultiFrontierMode,
  providerOperationFailureNotice,
  readNewerMultiFrontierSnapshot,
} from "./multi-frontier-renderer-state.js";
import { MultiFrontierParticipantSettings } from "./MultiFrontierWorkspace.js";

describe("CodeAgentsHub multi-frontier event boundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("rejects wrong-collaboration and stale events while preserving notices", () => {
    const event = {
      schemaVersion: 1,
      type: "event",
      collaborationId: "collaboration-1",
      sequence: 4,
      event: {
        kind: "notice",
        text: "Recovered safely.",
      },
    } satisfies MultiFrontierIpcEvent;

    expect(
      readNewerMultiFrontierSnapshot("collaboration-1", 4, event),
    ).toBeNull();
    expect(
      readNewerMultiFrontierSnapshot("other-collaboration", 3, event),
    ).toBeNull();
    expect(readNewerMultiFrontierSnapshot("collaboration-1", 3, event)).toEqual(
      {
        sequence: 4,
        snapshot: undefined,
        notice: {
          id: "collaboration-1:4",
          kind: "info",
          message: "Recovered safely.",
        },
      },
    );
  });

  it("seeds each run from the persisted default without coupling later edits", () => {
    const persistedDefault = { autoContinueAfterAgreement: true };
    let runAutoContinue = initialMultiFrontierRunAutoContinue(persistedDefault);

    runAutoContinue = false;

    expect(runAutoContinue).toBe(false);
    expect(persistedDefault).toEqual({ autoContinueAfterAgreement: true });
  });

  it("keeps the collaboration mode selected until a run is terminal", () => {
    expect(locksMultiFrontierMode({ phase: "implementing" })).toBe(true);
    expect(locksMultiFrontierMode({ phase: "paused" })).toBe(true);
    expect(locksMultiFrontierMode({ phase: "completed" })).toBe(false);
    expect(locksMultiFrontierMode({ phase: "failed" })).toBe(false);
  });

  it("reports provider-operation failures without surfacing raw provider errors", () => {
    expect(
      providerOperationFailureNotice("claude", "connect", "notice-1"),
    ).toEqual({
      id: "notice-1",
      kind: "failure",
      message:
        "Could not connect for Claude. Try again or check its local sign-in.",
    });
  });

  it("keeps the mode selector keyboard-focusable while a collaboration is inactive", async () => {
    const onModeChange = vi.fn();
    act(() => {
      root.render(
        React.createElement(MultiFrontierModeControl, {
          active: false,
          permissionMode: "full-auto",
          subscriptions: {},
          busy: false,
          modeLocked: false,
          autoContinueAfterAgreement: false,
          defaultAutoContinueAfterAgreement: false,
          onModeChange,
          onConnectSubscription: vi.fn(),
          onRefreshSubscription: vi.fn(),
          onAutoContinueAfterAgreementChange: vi.fn(),
          onDefaultAutoContinueAfterAgreementChange: vi.fn(),
        }),
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Run mode"]',
    );
    expect(trigger).not.toBeNull();
    expect(
      container.querySelector(".code-agents-multi-frontier-control"),
    ).toContain(trigger);
    expect(
      trigger?.classList.contains("code-agents-multi-frontier-mode-select"),
    ).toBe(true);
    expect(trigger?.classList.contains("desktop-select-trigger")).toBe(true);
    expect(container.textContent).not.toContain("Participants");
    expect(container.textContent).not.toContain("Connect");
    act(() => trigger?.focus());
    expect(document.activeElement).toBe(trigger);

    await act(async () => {
      trigger?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      await Promise.resolve();
    });

    const options = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    const menu = document.querySelector<HTMLElement>('[role="listbox"]');
    expect(menu?.classList.contains("code-agents-select-content")).toBe(true);
    expect(
      menu?.classList.contains("code-agents-multi-frontier-mode-menu"),
    ).toBe(true);
    expect(
      options.every((option) =>
        option.classList.contains("code-agents-multi-frontier-mode-menu-item"),
      ),
    ).toBe(true);
    expect(document.body.textContent).toContain(
      "Codex + Claude plan, review, then one builds",
    );
    expect(
      document.querySelector<HTMLElement>("[aria-label='Run mode']")
        ?.textContent,
    ).toContain("Auto");
    expect(
      document.querySelector<HTMLElement>("[aria-label='Run mode']")
        ?.textContent,
    ).not.toContain("One agent plans and builds");

    const multiFrontierOption = options.find((option) =>
      option.textContent?.startsWith("Multi-Frontier"),
    );
    expect(multiFrontierOption).toBeDefined();

    await act(async () => {
      multiFrontierOption?.click();
      await Promise.resolve();
    });

    expect(onModeChange).toHaveBeenCalledWith("multi-frontier");

    act(() => {
      root.render(
        React.createElement(MultiFrontierModeControl, {
          active: true,
          permissionMode: "full-auto",
          subscriptions: {},
          busy: false,
          modeLocked: false,
          autoContinueAfterAgreement: false,
          defaultAutoContinueAfterAgreement: false,
          onModeChange,
          onConnectSubscription: vi.fn(),
          onRefreshSubscription: vi.fn(),
          onAutoContinueAfterAgreementChange: vi.fn(),
          onDefaultAutoContinueAfterAgreementChange: vi.fn(),
        }),
      );
    });
    expect(container.textContent).toContain("Connect");
  });

  it("registers toolkit overlay styles in the desktop Tailwind build", () => {
    const shellCss = readFileSync("src/renderer/shell.css", "utf8");

    expect(shellCss).toContain('@import "@agent-native/toolkit/styles.css";');
  });

  it("keeps the chat-first chat column aligned and narrower than its apps grid", () => {
    const shellCss = readFileSync("src/renderer/shell.css", "utf8");

    expect(shellCss).toContain(
      "width: min(100%, var(--code-agents-chat-max)) !important;",
    );
    expect(shellCss).toMatch(
      /\.desktop-chat-first-hub \.code-agents-start \.code-agents-provider-gate\s*\{[\s\S]*?align-self: center;[\s\S]*?width: min\(100%, var\(--code-agents-chat-max\)\);[\s\S]*?max-width: var\(--code-agents-chat-max\);/,
    );
    expect(shellCss).toMatch(
      /\.desktop-apps-grid\s*\{[\s\S]*?max-width: 1000px;/,
    );
    expect(shellCss).toMatch(
      /\.desktop-chat-first-hub \.code-agents-start \.code-agents-project-picker--bar\s*\{[\s\S]*?margin-top: -10px;/,
    );
    expect(shellCss).toMatch(
      /\.desktop-chat-first-hub \.code-agents-start \.code-agents-overview-footer\s*\{[\s\S]*?margin-top: 10px;/,
    );
  });

  it("keeps all visible chat-first app surfaces mounted in the main view", () => {
    const hubSource = readFileSync(
      "src/renderer/components/CodeAgentsHub.tsx",
      "utf8",
    );

    expect(hubSource).toContain("<ChatFirstSurfaceContent");
    expect(hubSource).toContain("tabs={visibleChatFirstSurfaceTabs}");
    expect(hubSource).toContain(
      "activeTabId={visibleActiveChatFirstSurfaceTabId}",
    );
  });

  it("keeps the chat-first rail collapse control at the bottom of the rail", () => {
    const hubSource = readFileSync(
      "src/renderer/components/CodeAgentsHub.tsx",
      "utf8",
    );
    const appSource = readFileSync(
      "../code-agents-ui/src/CodeAgentsApp.tsx",
      "utf8",
    );
    const shellCss = readFileSync("src/renderer/shell.css", "utf8");

    expect(hubSource).toContain("desktop-chat-first-rail-footer-actions");
    expect(hubSource).toContain(
      'desktop-chat-first-rail-settings"\n                    onClick',
    );
    expect(hubSource).toContain("IconLayoutSidebarLeftCollapse");
    expect(hubSource).toContain("desktop-chat-first-rail-collapse");
    expect(hubSource).toContain("data-chat-first-rail-collapse");
    expect(hubSource).toContain("setChatFirstRailCollapsed(true)");
    expect(hubSource).not.toContain(
      '{chatFirstRailCollapsed ? "Expand" : "Collapse"}',
    );
    expect(appSource).toContain("code-agents-surface--rail-collapsed");
    expect(shellCss).toContain("grid-template-columns: 56px minmax(0, 1fr);");
    expect(shellCss).toContain(
      ".desktop-chat-first-rail-footer-actions > .code-agents-nav-link",
    );
    expect(shellCss).toContain("code-agents-primary-new-chat-shell");
    expect(shellCss).toContain(
      ".desktop-chat-first-hub .code-agents-rail--collapsed .code-agents-nav-link",
    );
    expect(shellCss).toContain("border-bottom: 0;");
    expect(shellCss).toMatch(
      /\.desktop-chat-first-rail-footer-actions\s*>\s*\.desktop-chat-first-rail-settings\s*\{[\s\S]*?flex: 1 1 auto;/,
    );
    expect(shellCss).toContain("visibility: hidden;");
    expect(shellCss).toContain("margin-top: auto;");
    expect(shellCss).toContain("height: 100%;");
    expect(shellCss).toContain("min-height: 0;");
    expect(shellCss).toContain("z-index: 1;");
    expect(shellCss).toContain("[data-chat-first-rail-collapse]");
  });

  it("orders pinned desktop apps ahead of unpinned apps and filters by name or description", () => {
    const apps = [
      {
        id: "alpha",
        name: "Alpha Notes",
        description: "Write and review",
        enabled: true,
      },
      {
        id: "bravo",
        name: "Bravo Mail",
        description: "Inbox and threads",
        enabled: true,
      },
      {
        id: "charlie",
        name: "Charlie Calendar",
        description: "Plan meetings",
        enabled: true,
      },
    ] as const;

    const ordered = orderDesktopApps([...apps], {
      pinnedIds: ["charlie"],
      orderedIds: ["bravo", "alpha"],
    });

    expect(ordered.map((app) => app.id)).toEqual(["charlie", "bravo", "alpha"]);
    expect(filterDesktopApps(ordered, "INBOX").map((app) => app.id)).toEqual([
      "bravo",
    ]);
    expect(filterDesktopApps(ordered, "plan").map((app) => app.id)).toEqual([
      "charlie",
    ]);
  });

  it("keeps local apps first while adding each workspace app once", () => {
    const merged = mergeDesktopAppLists(
      [{ id: "mail" }, { id: "personal-notes" }],
      [{ id: "team-ops" }, { id: "mail" }],
    );

    expect(merged.map((app) => app.id)).toEqual([
      "mail",
      "personal-notes",
      "team-ops",
    ]);
  });

  it("uses the Electron default app order before the remaining catalog", () => {
    const ordered = orderDesktopApps(
      [
        { id: "brain", enabled: true },
        { id: "analytics", enabled: true },
        { id: "content", enabled: true },
        { id: "design", enabled: true },
        { id: "mail", enabled: true },
        { id: "calendar", enabled: true },
        { id: "clips", enabled: true },
      ],
      { pinnedIds: [], orderedIds: [] },
    );

    expect(ordered.map((app) => app.id)).toEqual([
      "mail",
      "calendar",
      "design",
      "clips",
      "content",
      "analytics",
      "brain",
    ]);
  });

  it("renders the desktop apps grid controls in the hub source", () => {
    const hubSource = readFileSync(
      "src/renderer/components/CodeAgentsHub.tsx",
      "utf8",
    );

    expect(hubSource).toContain("Search apps");
    expect(hubSource).toContain("desktop-apps-grid__search");
    expect(hubSource).toContain("desktop-app-card__body");
    expect(hubSource).toContain(
      "data-app-id={app.id}\n                  onClick={() => onOpenApp(app)}",
    );
    expect(hubSource).toContain("AppOpenActions");
    expect(hubSource).toContain("desktop-app-card__actions");
    expect(hubSource).toContain("Open in browser");
    expect(hubSource).toContain("Pin this app");
    expect(hubSource).toContain("Unpin this app");
    expect(hubSource).toContain("desktop-apps-grid--full-page");
    expect(hubSource).toContain("chatFirstAllAppsOpen");
    expect(hubSource).toContain("onOpenAllApps={openChatFirstAllApps}");
    expect(hubSource).not.toContain("desktop-apps-grid__summary");
    expect(hubSource).toContain("layout={chatFirstAppLayout}");
    expect(hubSource).toContain("onTogglePinned={toggleChatFirstAppPinned}");
  });

  it("keeps normal app opens embedded and makes browser opening explicit", () => {
    const hubSource = readFileSync(
      "src/renderer/components/CodeAgentsHub.tsx",
      "utf8",
    );

    expect(hubSource).toContain(
      'terminalPreferences.enabled ? "side" : "main"',
    );
    expect(hubSource).toContain("<AppWebview");
    expect(hubSource).toContain("onOpenInBrowser={openChatFirstAppInBrowser}");
    expect(hubSource).toContain(
      "void window.electronAPI.shell.openExternal(url)",
    );
  });

  it("keeps full-page settings on the shared query and theme contracts", () => {
    const settingsSource = readFileSync(
      "src/renderer/components/AppSettings.tsx",
      "utf8",
    );
    const shellCss = readFileSync("src/renderer/shell.css", "utf8");

    expect(settingsSource).toContain("createAgentNativeQueryClient");
    expect(settingsSource).toContain(
      "<QueryClientProvider client={desktopSettingsQueryClient}>",
    );
    expect(shellCss).toContain("--border: 0 0% 24%;");
    expect(shellCss).toContain("--radius: 0.5rem;");
    expect(shellCss).toContain(".settings-page-tabs-content .settings-btn");
  });

  it("passes the chat-first unavailable-notice presentation guard", () => {
    const hubSource = readFileSync(
      "src/renderer/components/CodeAgentsHub.tsx",
      "utf8",
    );

    expect(hubSource).toContain("suppressChatFirstUnavailableNotice");
    expect(hubSource).toContain('error: "Desktop bridge is not available."');
  });

  it("keeps inactive chat-first tabs from inheriting the active webview state", () => {
    expect(
      isChatFirstSurfaceTabActive({
        surfaceActive: true,
        tabId: "tab-1",
        activeTabId: "tab-1",
      }),
    ).toBe(true);
    expect(
      isChatFirstSurfaceTabActive({
        surfaceActive: true,
        tabId: "tab-1",
        activeTabId: "tab-2",
      }),
    ).toBe(false);
    expect(
      isChatFirstSurfaceTabActive({
        surfaceActive: false,
        tabId: "tab-1",
        activeTabId: "tab-1",
      }),
    ).toBe(false);
  });

  it("shares the created app partition with chat-first previews", () => {
    expect(chatFirstPreviewPartitionKey("app-1")).toBe("persist:app-app-1");
    expect(chatFirstPreviewPartitionKey("  app-1  ")).toBe("persist:app-app-1");
    expect(chatFirstPreviewPartitionKey(undefined)).toBe(
      "persist:chat-first-browser",
    );
  });

  it("builds app surface tabs without losing arbitrary route state", () => {
    expect(
      chatFirstAppSurfaceTab(
        { id: "calendar", name: "Calendar" },
        "/events/42?mode=week#details",
        "event",
      ),
    ).toEqual({
      id: "app:calendar:/events/42?mode=week#details:event",
      kind: "app",
      title: "Calendar",
      appId: "calendar",
      path: "/events/42?mode=week#details",
      view: "event",
    });
  });

  it("opens Dispatch control-plane pages without nested navigation chrome", () => {
    expect(isDispatchControlPlanePath("/integrations")).toBe(true);
    expect(isDispatchControlPlanePath("/integrations/stripe")).toBe(true);
    expect(isDispatchControlPlanePath("/admin/automations?view=all")).toBe(
      true,
    );
    expect(isDispatchControlPlanePath("/admin/integrations/slack/setup")).toBe(
      true,
    );
    expect(isDispatchControlPlanePath("/overview")).toBe(false);
    expect(isDispatchControlPlanePath("/integrations-extra")).toBe(false);
    expect(dispatchControlPlaneUrlParams("/automations")).toEqual({
      embedded: "1",
      chatFirst: null,
      electron: "1",
    });
    expect(dispatchControlPlaneUrlParams("/apps")).toEqual({
      embedded: "1",
      chatFirst: "1",
    });
    expect(dispatchControlPlaneTitle("/integrations/slack")).toBe(
      "Integrations",
    );
    expect(dispatchControlPlaneTitle("/admin/automations?view=all")).toBe(
      "Automations",
    );
  });

  it("keeps Dispatch internal while excluding it from Electron app discovery", () => {
    const apps = [
      { id: "dispatch" },
      { id: "calendar" },
      { id: "agent" },
    ] as const;

    expect(isDesktopAppVisible({ id: "dispatch" })).toBe(false);
    expect(isDesktopAppVisible({ id: "calendar" })).toBe(true);
    expect(getDesktopVisibleApps(apps).map((app) => app.id)).toEqual([
      "calendar",
      "agent",
    ]);
  });

  it("records whether an app was opened from the rail or the agent", () => {
    expect(
      chatFirstAppSurfaceTab(
        { id: "analytics", name: "Analytics" },
        "/adhoc/q2",
        undefined,
        "side",
      ),
    ).toMatchObject({
      kind: "app",
      appId: "analytics",
      placement: "side",
      path: "/adhoc/q2",
    });
    expect(
      chatFirstAppSurfaceTab(
        { id: "analytics", name: "Analytics" },
        "/",
        undefined,
        "main",
      ).placement,
    ).toBe("main");
  });

  it("renders a live provider update in the subscription usage popover", async () => {
    act(() => {
      root.render(
        React.createElement(MultiFrontierParticipantSettings, {
          statuses: {
            codex: {
              schemaVersion: 1,
              providerId: "codex",
              connectionState: "connected",
              telemetry: {
                state: "live",
                source: "codex-app-server",
                updatedAt: "2026-07-19T12:00:00.000Z",
                capabilities: {
                  account: false,
                  plan: false,
                  rateLimits: true,
                  modelTierRateLimits: false,
                  contextWindow: false,
                  credits: false,
                  liveUpdates: true,
                },
                meters: [
                  {
                    id: "five-hour",
                    kind: "five-hour",
                    state: "available",
                    usedPercent: 42,
                  },
                ],
              },
            },
          },
          busy: false,
          autoContinueAfterAgreement: false,
          defaultAutoContinueAfterAgreement: false,
        }),
      );
    });

    const participants = container.querySelector<HTMLButtonElement>("button");
    expect(participants).toBeDefined();
    await act(async () => {
      participants?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
      participants?.click();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain(
      "Usage is updating from the connected subscription",
    );
  });
});
