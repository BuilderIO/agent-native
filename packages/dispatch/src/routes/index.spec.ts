import { describe, expect, it } from "vitest";

import { dispatchRoutes } from "./index.js";

describe("Dispatch route registration", () => {
  it("registers chat and operator routes before the workspace-app fallback", () => {
    const routes = dispatchRoutes as Array<{
      path?: string;
      file?: string;
      index?: boolean;
    }>;
    const paths = routes.map((route) => route.path);

    expect(paths).toContain("chat");
    expect(paths).toContain("chat/:threadId");
    expect(paths).toContain("operations");
    expect(paths.indexOf("chat")).toBeLessThan(paths.indexOf(":appId"));
    expect(paths.indexOf("chat/:threadId")).toBeLessThan(
      paths.indexOf(":appId"),
    );
    expect(paths.indexOf("operations")).toBeLessThan(paths.indexOf(":appId"));
  });
});
