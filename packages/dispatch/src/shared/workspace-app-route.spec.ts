import { describe, expect, it } from "vitest";

import {
  workspaceAppCatalogRoute,
  workspaceAppRoute,
} from "./workspace-app-route";

describe("workspace app catalog destinations", () => {
  it("links the control plane to its own mount instead of embedding itself", () => {
    expect(workspaceAppCatalogRoute("dispatch")).toBe("/dispatch");
  });

  it.each(["notes", "sales ops", "nested/path"])(
    "keeps %s on its encoded app route",
    (id) => {
      expect(workspaceAppCatalogRoute(id)).toBe(
        `/apps/${encodeURIComponent(id)}`,
      );
    },
  );

  it("preserves explicit embed route construction", () => {
    expect(workspaceAppRoute("dispatch")).toBe("/apps/dispatch");
  });
});
