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
  isNativeDesktopIntegrationsPath,
  shouldShowNativeDesktopIntegrations,
  shouldShowNativeDesktopIntegrationsGuest,
  shouldUseDesktopAppChatShell,
  isChatFirstSurfaceTabActive,
  updateAppAuthStateByTab,
  updateWebContentsIdByTab,
  updateDesktopIdentityStatusByTab,
  orderDesktopApps,
  resolveDesktopChatFirstPrimaryTab,
  MultiFrontierModeControl,
} from "./CodeAgentsHub.js";
import {
  initialMultiFrontierRunAutoContinue,
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
    expect(isNativeDesktopIntegrationsPath("/integrations")).toBe(true);
    expect(isNativeDesktopIntegrationsPath("/admin/integrations")).toBe(true);
    expect(isNativeDesktopIntegrationsPath("/integrations/slack")).toBe(false);
  });

  it("exposes native integrations before guest auth finishes loading", () => {
    expect(
      shouldShowNativeDesktopIntegrations({
        appId: "dispatch",
        path: "/integrations",
        appAuthState: "unknown",
      }),
    ).toBe(true);
    expect(
      shouldShowNativeDesktopIntegrations({
        appId: "dispatch",
        path: "/integrations",
        appAuthState: "authenticated",
      }),
    ).toBe(true);
    expect(
      shouldShowNativeDesktopIntegrations({
        appId: "dispatch",
        path: "/integrations",
        appAuthState: "unauthenticated",
      }),
    ).toBe(false);
    expect(
      shouldShowNativeDesktopIntegrations({
        appId: "calendar",
        path: "/integrations",
      }),
    ).toBe(false);
    expect(
      shouldShowNativeDesktopIntegrations({
        appId: "dispatch",
        path: "/integrations/slack",
      }),
    ).toBe(false);
  });

  it("keeps the primary Integrations surface out of per-app chat", () => {
    expect(shouldUseDesktopAppChatShell("/integrations")).toBe(false);
    expect(shouldUseDesktopAppChatShell("/admin/integrations")).toBe(false);
    expect(shouldUseDesktopAppChatShell("/calendar")).toBe(true);
  });

  it("shows the authenticated guest during native MCP OAuth", () => {
    expect(
      shouldShowNativeDesktopIntegrationsGuest({
        showNativeIntegrations: true,
        nativeOAuthActive: false,
      }),
    ).toBe(false);
    expect(
      shouldShowNativeDesktopIntegrationsGuest({
        showNativeIntegrations: true,
        nativeOAuthActive: true,
      }),
    ).toBe(true);
    expect(
      shouldShowNativeDesktopIntegrationsGuest({
        showNativeIntegrations: false,
        nativeOAuthActive: false,
      }),
    ).toBe(true);
  });

  it("keeps OAuth scoped to the current guest webview id", () => {
    const current = updateWebContentsIdByTab({}, "dispatch-tab", 42);
    expect(current).toEqual({ "dispatch-tab": 42 });
    expect(updateWebContentsIdByTab(current, "dispatch-tab", 43)).toEqual({
      "dispatch-tab": 43,
    });
    expect(
      updateWebContentsIdByTab(current, "dispatch-tab", undefined),
    ).toEqual({});
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

describe("CodeAgentsHub desktop identity status", () => {
  it("keeps duplicate app tabs isolated across identity transitions", () => {
    let statusByTab = updateDesktopIdentityStatusByTab(
      {},
      "mail-tab-1",
      "sign-in-required",
    );
    statusByTab = updateDesktopIdentityStatusByTab(
      statusByTab,
      "mail-tab-2",
      "idle",
    );
    statusByTab = updateDesktopIdentityStatusByTab(
      statusByTab,
      "mail-tab-1",
      "signed-in",
    );

    expect(statusByTab).toEqual({
      "mail-tab-1": "signed-in",
      "mail-tab-2": "idle",
    });
  });
});

describe("CodeAgentsHub app auth state", () => {
  it("keeps auth state isolated across app tabs", () => {
    let stateByTab = updateAppAuthStateByTab(
      {},
      "dispatch-tab-1",
      "unauthenticated",
    );
    stateByTab = updateAppAuthStateByTab(
      stateByTab,
      "dispatch-tab-2",
      "authenticated",
    );
    stateByTab = updateAppAuthStateByTab(
      stateByTab,
      "dispatch-tab-1",
      "authenticated",
    );

    expect(stateByTab).toEqual({
      "dispatch-tab-1": "authenticated",
      "dispatch-tab-2": "authenticated",
    });
  });

  it("does not demote a confirmed state while a navigation probe is pending", () => {
    const authenticated = updateAppAuthStateByTab(
      {},
      "dispatch-tab",
      "authenticated",
    );
    expect(
      updateAppAuthStateByTab(authenticated, "dispatch-tab", "unknown"),
    ).toBe(authenticated);

    const unauthenticated = updateAppAuthStateByTab(
      authenticated,
      "dispatch-tab",
      "unauthenticated",
    );
    expect(unauthenticated).toEqual({ "dispatch-tab": "unauthenticated" });
    expect(
      updateAppAuthStateByTab(unauthenticated, "dispatch-tab", "unknown"),
    ).toBe(unauthenticated);
  });
});

describe("resolveDesktopChatFirstPrimaryTab", () => {
  it("names the scheduled surface so the rail can deactivate app icons", () => {
    expect(
      resolveDesktopChatFirstPrimaryTab({
        scheduledTasksOpen: true,
        appSelected: false,
        activeTab: null,
      }),
    ).toBe("scheduled");
  });

  it("keeps naming scheduled even if an app tab is still open underneath", () => {
    expect(
      resolveDesktopChatFirstPrimaryTab({
        scheduledTasksOpen: true,
        appSelected: true,
        activeTab: { kind: "app", appId: "mail" },
      }),
    ).toBe("scheduled");
  });

  it("names the chats surface when nothing else owns the rail", () => {
    expect(
      resolveDesktopChatFirstPrimaryTab({
        scheduledTasksOpen: false,
        appSelected: false,
        activeTab: null,
      }),
    ).toBe("new-chat");
  });

  it("names no tab when a workspace app owns the rail", () => {
    expect(
      resolveDesktopChatFirstPrimaryTab({
        scheduledTasksOpen: false,
        appSelected: true,
        activeTab: { kind: "app", appId: "mail", path: "/inbox" },
      }),
    ).toBeUndefined();
  });

  it("maps the dispatch-hosted integrations and automations paths", () => {
    expect(
      resolveDesktopChatFirstPrimaryTab({
        scheduledTasksOpen: false,
        appSelected: true,
        activeTab: { kind: "app", appId: "dispatch", path: "/integrations" },
      }),
    ).toBe("integrations");
    expect(
      resolveDesktopChatFirstPrimaryTab({
        scheduledTasksOpen: false,
        appSelected: true,
        activeTab: { kind: "app", appId: "dispatch", path: "/automations" },
      }),
    ).toBe("scheduled");
  });
});
