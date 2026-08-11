import { describe, expect, it } from "vitest";

import {
  isDefaultWorkspaceAppHiddenId,
  isDispatchWorkspaceAppId,
  isWorkspaceAppVisibleInDefaultLaunchers,
  workspaceAppIdFromRoute,
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
});
