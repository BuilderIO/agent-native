import { describe, expect, it } from "vitest";

import { workspaceAppIdFromRoute, workspaceAppRoute } from "./workspace-apps";

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
});
