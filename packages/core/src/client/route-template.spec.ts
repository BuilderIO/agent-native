import { describe, expect, it } from "vitest";

import { routeTemplateForPath } from "./route-template.js";

const routes = {
  root: { id: "root", path: "" },
  "routes/_index": { id: "routes/_index", parentId: "root", index: true },
  "routes/sessions": {
    id: "routes/sessions",
    parentId: "root",
    path: "sessions",
  },
  "routes/sessions._index": {
    id: "routes/sessions._index",
    parentId: "routes/sessions",
    index: true,
  },
  "routes/sessions.$id": {
    id: "routes/sessions.$id",
    parentId: "routes/sessions",
    path: ":id",
  },
  "routes/sessions.events": {
    id: "routes/sessions.events",
    parentId: "routes/sessions",
    path: "events",
  },
  "routes/docs.$": { id: "routes/docs.$", parentId: "root", path: "docs/*" },
  "routes/($lang).pricing": {
    id: "routes/($lang).pricing",
    parentId: "root",
    path: ":lang?/pricing",
  },
};

describe("routeTemplateForPath", () => {
  it("names the matched manifest route instead of the ids in the URL", () => {
    expect(routeTemplateForPath("/sessions/rec_8f2a91", routes)).toBe(
      "/sessions/:id",
    );
    expect(routeTemplateForPath("/sessions", routes)).toBe("/sessions");
    expect(routeTemplateForPath("/", routes)).toBe("/");
  });

  it("ranks a static segment above a dynamic one, as React Router does", () => {
    expect(routeTemplateForPath("/sessions/events", routes)).toBe(
      "/sessions/events",
    );
    expect(routeTemplateForPath("/Sessions/Events/", routes)).toBe(
      "/sessions/events",
    );
  });

  it("matches splat and optional segments", () => {
    expect(routeTemplateForPath("/docs/guides/private-title", routes)).toBe(
      "/docs/*",
    );
    expect(routeTemplateForPath("/de/pricing", routes)).toBe("/:lang/pricing");
    expect(routeTemplateForPath("/pricing", routes)).toBe("/pricing");
  });

  it("matches inside the app basename", () => {
    expect(
      routeTemplateForPath(
        "/apps/analytics/sessions/rec_1",
        routes,
        "/apps/analytics/",
      ),
    ).toBe("/sessions/:id");
  });

  it("falls back to the id-normalized path when no route matches", () => {
    expect(
      routeTemplateForPath(
        "/unknown/123/2f1b8c1e-6a5d-4f3e-9b2a-1c2d3e4f5a6b",
        routes,
      ),
    ).toBe("/unknown/:id/:id");
    expect(routeTemplateForPath("/sessions/123", undefined)).toBe(
      "/sessions/:id",
    );
    expect(
      routeTemplateForPath("/sessions/42", routes, "/apps/analytics"),
    ).toBe("/sessions/:id");
  });
});
