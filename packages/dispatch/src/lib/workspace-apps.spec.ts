import { describe, expect, it } from "vitest";

import {
  isDefaultWorkspaceAppHiddenId,
  isDispatchWorkspaceAppId,
  isPathMountedWorkspaceApp,
  isWorkspaceAppVisibleInDefaultLaunchers,
  isWorkspaceSsoApp,
  mergeChatFirstWorkspaceApps,
  workspaceAppIdFromRoute,
  workspaceAppDirectHref,
  workspaceAppRoute,
} from "./workspace-apps";

describe("workspace app routes", () => {
  it("round-trips encoded app ids", () => {
    const route = workspaceAppRoute("sales ops");
    expect(route).toBe("/apps/sales%20ops");
    expect(workspaceAppIdFromRoute(route)).toBe("sales ops");
  });

  it("does not mark app paths or the apps index as an active app route", () => {
    expect(workspaceAppIdFromRoute("/sales-ops")).toBeNull();
    expect(workspaceAppIdFromRoute("/apps")).toBeNull();
    expect(workspaceAppIdFromRoute("/overview")).toBeNull();
  });

  it("accepts nested app routes while preserving the app id", () => {
    expect(workspaceAppIdFromRoute("/apps/mail/inbox")).toBe("mail");
  });

  it("identifies Dispatch regardless of casing or surrounding whitespace", () => {
    expect(isDispatchWorkspaceAppId(" Dispatch ")).toBe(true);
    expect(isDispatchWorkspaceAppId("dispatch-tools")).toBe(false);
  });

  it("requires canonical metadata before enabling workspace SSO", () => {
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
    });
  });
});
