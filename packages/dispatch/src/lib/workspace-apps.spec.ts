// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  isDefaultWorkspaceAppHiddenId,
  isDispatchWorkspaceAppId,
  isPathMountedWorkspaceApp,
  isWorkspaceAppVisibleInDefaultLaunchers,
  isWorkspaceSsoApp,
  mergeChatFirstWorkspaceApps,
  workspaceAppIdFromRoute,
  workspaceAppInitialPathFromSplat,
  workspaceAppRouteForChildPath,
  workspaceAppDirectHref,
  workspaceAppDirectLaunchHref,
  workspaceAppHref,
  workspaceAppRoute,
} from "./workspace-apps";

describe("workspace app routes", () => {
  it("targets the registered authenticated home path", () => {
    expect(
      workspaceAppHref({ id: "mail", path: "/mail", homePath: "/inbox" }),
    ).toBe("/mail/inbox");
    expect(workspaceAppHref({ id: "mail", path: "/mail" })).toBe("/mail/home");
    expect(
      workspaceAppHref({
        id: "feedback-leaderboard",
        path: "/feedback-leaderboard",
        url: "https://workspace.example.test/feedback-leaderboard/leaderboard",
      }),
    ).toBe("https://workspace.example.test/feedback-leaderboard/leaderboard");
  });

  it("opens grant-only apps directly at their registered URL", () => {
    expect(
      workspaceAppDirectLaunchHref({
        path: "",
        url: "https://sales.example.test/sales",
      }),
    ).toBe("https://sales.example.test/sales");
    expect(
      workspaceAppDirectLaunchHref({
        path: "/sales",
        url: "https://sales.example.test/sales",
      }),
    ).toBeNull();
  });

  it("round-trips encoded app ids", () => {
    const route = workspaceAppRoute("sales ops");
    expect(route).toBe("/apps/sales%20ops");
    expect(workspaceAppIdFromRoute(route)).toBe("sales ops");
  });

  it("marks fallback app descriptions for localization but preserves custom copy", () => {
    const calendar = mergeChatFirstWorkspaceApps([
      {
        id: "calendar",
        name: "Calendar",
        description:
          "Agent-Native Google Calendar — manage events, sync, and public booking",
        path: "/calendar",
      },
    ]).find((app) => app.id === "calendar");
    expect(calendar).toMatchObject({
      description:
        "Agent-Native Google Calendar — manage events, sync, and public booking",
      defaultDescriptionKey:
        "dispatch.pages.chatFirstDefaultDescriptionCalendar",
    });

    const mail = mergeChatFirstWorkspaceApps([
      {
        id: "mail",
        name: "Mail",
        description: "A workspace-specific description",
        path: "/mail",
      },
    ]).find((app) => app.id === "mail");
    expect(mail).toMatchObject({
      description: "A workspace-specific description",
      defaultDescriptionKey: undefined,
    });

    const emptyDescription = mergeChatFirstWorkspaceApps([
      { id: "mail", name: "Mail", description: "", path: "/mail" },
    ]).find((app) => app.id === "mail");
    expect(emptyDescription).toMatchObject({
      description: "",
      defaultDescriptionKey: undefined,
    });
  });

  it("includes granted-only apps without replacing registered app summaries", () => {
    const apps = mergeChatFirstWorkspaceApps(
      [{ id: "Calendar", name: "Workspace Calendar", path: "/calendar" }],
      [
        {
          id: "calendar",
          name: "Granted Calendar",
          url: "https://calendar.example.test",
        },
        {
          id: "sales-tools",
          name: "Sales Tools",
          description: "Sales workspace tools",
          url: "https://sales.example.test",
        },
      ],
    );

    const calendarApps = apps.filter(
      (app) => app.id.toLowerCase() === "calendar",
    );
    expect(calendarApps).toHaveLength(1);
    expect(calendarApps[0]).toMatchObject({
      id: "calendar",
      name: "Workspace Calendar",
      path: "/calendar",
    });
    expect(apps.find((app) => app.id === "sales-tools")).toMatchObject({
      name: "Sales Tools",
      description: "Sales workspace tools",
      path: "",
      url: "https://sales.example.test",
      status: "ready",
    });
  });

  it("does not mark app paths or the apps index as an active app route", () => {
    expect(workspaceAppIdFromRoute("/sales-ops")).toBeNull();
    expect(workspaceAppIdFromRoute("/apps")).toBeNull();
    expect(workspaceAppIdFromRoute("/overview")).toBeNull();
  });

  it("accepts nested app routes while preserving the app id", () => {
    expect(workspaceAppIdFromRoute("/apps/mail/inbox")).toBe("mail");
  });

  it("preserves the initial app suffix for a standalone deep link", () => {
    expect(
      workspaceAppInitialPathFromSplat("inbox", "?view=unread", "#top"),
    ).toBe("/inbox?view=unread#top");
    expect(workspaceAppInitialPathFromSplat(undefined, "", "")).toBeUndefined();
  });

  it("maps child routes to shareable Dispatch app routes", () => {
    expect(
      workspaceAppRouteForChildPath(
        { id: "design", path: "/", url: "https://design.example.test" },
        "/foobar?mode=edit#canvas",
      ),
    ).toBe("/apps/design/foobar?mode=edit#canvas");
    expect(
      workspaceAppRouteForChildPath(
        {
          id: "internal-design",
          path: "/design",
          url: "https://workspace.example.test/design",
        },
        "/design/foobar",
      ),
    ).toBe("/apps/internal-design/foobar");
    expect(
      workspaceAppRouteForChildPath(
        { id: "design", path: "/", url: "https://design.example.test" },
        "//evil.example/route",
      ),
    ).toBeNull();
    expect(
      workspaceAppDirectHref(
        { path: "/", url: "https://design.example.test" },
        "/foobar?mode=edit#canvas",
      ),
    ).toBe("https://design.example.test/foobar?mode=edit#canvas");
  });

  it("identifies Dispatch regardless of casing or surrounding whitespace", () => {
    expect(isDispatchWorkspaceAppId(" Dispatch ")).toBe(true);
    expect(isDispatchWorkspaceAppId("dispatch-tools")).toBe(false);
  });

  it("requires canonical metadata and the active environment for workspace SSO", () => {
    expect(
      isWorkspaceSsoApp({
        id: " Mail ",
        path: "/",
        url: "https://mail.agent-native.com",
      }),
    ).toBe(true);
    expect(
      isWorkspaceSsoApp({
        id: "mail",
        path: "/",
        url: "https://beta.mail.agent-native.com",
      }),
    ).toBe(false);
    expect(
      isWorkspaceSsoApp({
        id: "mail",
        path: "/mail",
        url: "https://agent-workspace.builder.io/mail",
      }),
    ).toBe(false);
    expect(
      isWorkspaceSsoApp({
        id: "feedback-leaderboard",
        path: "/feedback-leaderboard",
        url: "https://agent-workspace.builder.io/feedback-leaderboard",
      }),
    ).toBe(false);
  });

  it("accepts the server eligibility projection for registered custom apps", () => {
    expect(
      isWorkspaceSsoApp({
        id: "workspace-reports",
        path: "/workspace-reports",
        url: "https://reports.example.com/workspace-reports",
        workspaceSso: true,
      }),
    ).toBe(true);
    expect(
      isWorkspaceSsoApp({
        id: "workspace-reports",
        path: "/workspace-reports",
        url: "javascript:alert(1)",
        workspaceSso: true,
      }),
    ).toBe(false);
  });

  it("keeps canonical loopback apps eligible outside production", () => {
    expect(
      isWorkspaceSsoApp({
        id: "mail",
        path: "/mail",
        url: "http://localhost:8084",
      }),
    ).toBe(true);
  });

  it("identifies mounted apps and resolves their direct workspace href", () => {
    const app = {
      path: "/feedback-leaderboard",
      url: "https://agent-workspace.builder.io/feedback-leaderboard/leaderboard",
    };

    expect(isPathMountedWorkspaceApp(app)).toBe(true);
    expect(workspaceAppDirectHref(app, "/")).toBe(
      "https://agent-workspace.builder.io/feedback-leaderboard/leaderboard",
    );
    expect(
      isPathMountedWorkspaceApp({
        path: "/",
        url: "https://mail.agent-native.com",
      }),
    ).toBe(false);
    expect(
      isPathMountedWorkspaceApp({
        path: "/",
        url: "https://feedback.example.com",
      }),
    ).toBe(true);
  });

  it("hides the generic chat starter and Dispatch from default launchers", () => {
    expect(isDefaultWorkspaceAppHiddenId(" Chat ")).toBe(true);
    expect(isWorkspaceAppVisibleInDefaultLaunchers({ id: "chat" })).toBe(false);
    expect(
      isWorkspaceAppVisibleInDefaultLaunchers({
        id: "dispatch",
        isDispatch: true,
      }),
    ).toBe(false);
    expect(isWorkspaceAppVisibleInDefaultLaunchers({ id: "mail" })).toBe(true);
  });

  it("maps default first-party apps to their canonical hosted origins", () => {
    const apps = mergeChatFirstWorkspaceApps(undefined);
    expect(apps.find((app) => app.id === "content")?.description).toBeTruthy();
    expect(apps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "content",
          path: "/",
          url: "https://content.agent-native.com",
        }),
        expect.objectContaining({
          id: "design",
          path: "/",
          url: "https://design.agent-native.com",
        }),
        expect.objectContaining({
          id: "mail",
          path: "/",
          url: "https://mail.agent-native.com",
        }),
        expect.objectContaining({
          id: "calendar",
          path: "/",
          url: "https://calendar.agent-native.com",
        }),
        expect.objectContaining({
          id: "clips",
          path: "/",
          url: "https://clips.agent-native.com",
        }),
      ]),
    );
  });

  it("maps default first-party apps to beta origins in beta Dispatch", () => {
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { hostname: "beta.dispatch.agent-native.com" },
    });

    try {
      const apps = mergeChatFirstWorkspaceApps(undefined);
      expect(apps.find((app) => app.id === "mail")?.url).toBe(
        "https://beta.mail.agent-native.com/",
      );
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it("lets a mounted workspace app override a default row", () => {
    const apps = mergeChatFirstWorkspaceApps([
      {
        id: "mail",
        name: "Internal Mail",
        path: "/internal-mail",
        url: null,
        status: "ready",
      },
    ]);
    expect(apps.find((app) => app.id === "mail")).toMatchObject({
      name: "Internal Mail",
      path: "/internal-mail",
      url: null,
      description: expect.any(String),
    });
  });
});
