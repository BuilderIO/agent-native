import { describe, expect, it } from "vitest";

import { dispatchRoutes } from "./index.js";

describe("Dispatch route registration", () => {
  it("registers chat and operator routes before the workspace-app fallback", () => {
    const routes = dispatchRoutes as Array<{
      path?: string;
      file?: string;
      index?: boolean;
      children?: Array<{ path?: string; index?: boolean }>;
    }>;
    const paths = routes.map((route) => route.path);

    expect(paths).toContain("chat");
    expect(paths).toContain("chat/:threadId");
    expect(paths).toContain("browser-chat");
    expect(paths).toContain("browser-connect");
    expect(paths).toContain("operations");
    expect(paths).toContain("admin");
    expect(paths.indexOf("chat")).toBeLessThan(paths.indexOf(":appId"));
    expect(paths.indexOf("chat/:threadId")).toBeLessThan(
      paths.indexOf(":appId"),
    );
    expect(paths.indexOf("browser-chat")).toBeLessThan(paths.indexOf(":appId"));
    expect(paths.indexOf("browser-connect")).toBeLessThan(
      paths.indexOf(":appId"),
    );
    expect(paths.indexOf("operations")).toBeLessThan(paths.indexOf(":appId"));

    const admin = routes.find((route) => route.path === "admin");
    const adminPaths = admin?.children?.map((route) => route.path) ?? [];
    expect(adminPaths).toContain("operations");
    expect(adminPaths).not.toContain("apps");
    expect(adminPaths).not.toContain("apps/:appId");
    expect(adminPaths.indexOf("operations")).toBeGreaterThanOrEqual(0);
  });
});
