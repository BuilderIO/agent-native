import { describe, expect, it } from "vitest";

import { hasRoutePage, resolveRoutePage } from "@/components/workspace/pages";

import { isUnavailableAnalyticsRoute, resolveRoute } from "./registry";

/**
 * The Collections page lives at /home/collections. Its route was excluded from
 * the resolver's candidate list while keeping its catalogue entry and page, so
 * the served app resolved the URL to an empty frame even though every unit of
 * the chain (route entry, page entry, page spec) existed. Resolve the real URL.
 */
describe("resolveRoute", () => {
  it("opens App builder through the canonical project route", () => {
    const builder = resolveRoute("/project/example/latest/app");
    const notebook = resolveRoute("/project/example/latest/logic");
    expect(builder).toMatchObject({ id: "project-base", view: "app" });
    const builderPage = resolveRoutePage(builder);
    expect(builderPage).toBeDefined();
    expect(builderPage?.component).toBe(resolveRoutePage(notebook)?.component);
  });
  it("opens the project Agent view in the notebook", () => {
    const agent = resolveRoute("/project/example/latest/agent");
    const notebook = resolveRoute("/project/example/latest/logic");
    expect(agent).toMatchObject({ id: "project-base", view: "agent" });
    const agentPage = resolveRoutePage(agent);
    expect(agentPage).toBeDefined();
    expect(agentPage?.component).toBe(resolveRoutePage(notebook)?.component);
  });
  it.each(["model", "keys"])(
    "opens provider configuration for the shared composer /settings/%s link",
    (section) => {
      const route = resolveRoute(`/settings/${section}`);
      expect(route.view).toBe("agent");
      expect(route.selectedTab).toBe("agent");
      expect(resolveRoutePage(route, { isAdmin: true })).toBeDefined();
    },
  );
  it.each([
    ["/settings/integrations/builder", "integrations"],
    ["/settings/integrations/mcp", "integrations"],
    ["/settings/agent/resources/files", "agent"],
  ])(
    "keeps %s on its Settings page instead of leaving Settings",
    (path, view) => {
      const route = resolveRoute(path);
      expect(route).toMatchObject({ id: "settings", frame: "settings", view });
      expect(resolveRoutePage(route, { isAdmin: true })).toBeDefined();
    },
  );
  it.each([
    "/home/data/curation",
    "/home/data/semantic-layer",
    "/model-workbench/example/draft/datasets",
    "/context-studio/evals",
    "/context-studio/suggestions",
    "/context-studio/semantic-models",
  ])("treats the unbuilt destination %s as unavailable", (path) => {
    expect(isUnavailableAnalyticsRoute(resolveRoute(path))).toBe(true);
  });

  it.each([
    "/home/data",
    "/home/data/all",
    "/home/data/recommended",
    "/home/data/favorites",
    "/home/data/recently-used",
  ])("serves the built Data page at %s", (path) => {
    const route = resolveRoute(path);
    expect(isUnavailableAnalyticsRoute(route)).toBe(false);
    expect(resolveRoutePage(route)).toBeDefined();
    expect(resolveRoutePage(route)?.component).toBe(
      resolveRoutePage(resolveRoute("/home/data"))?.component,
    );
  });

  it("treats an unknown data tab as unavailable", () => {
    expect(
      isUnavailableAnalyticsRoute(resolveRoute("/home/data/unknown")),
    ).toBe(true);
  });

  it.each(["profile", "integrations", "audit-logs", "skills"])(
    "keeps /settings/%s on the settings frame instead of redirecting",
    (view) => {
      const route = resolveRoute(`/settings/${view}`, { isAdmin: true });
      expect(route).toMatchObject({ frame: "settings", view });
    },
  );
  it("resolves /home/collections to the Collections page", () => {
    const route = resolveRoute("/home/collections");
    expect(route.id).toBe("new-collection");
    expect(route.selectedTab).toBe("collections");
    expect(hasRoutePage(route.id, route.view)).toBe(true);
    expect(resolveRoutePage(route)).toBeDefined();
  });

  it("keeps /home/search?q= on the home frame with its query intact", () => {
    const route = resolveRoute("/home/search?q=revenue");
    expect(route).toMatchObject({ frame: "home", view: "home" });
    expect(route.query.get("q")).toBe("revenue");
  });

  it("redirects legacy /search?q= to /home/search?q= without dropping the query", () => {
    const route = resolveRoute("/search?q=revenue");
    expect(route).toMatchObject({
      frame: "redirect",
      to: "/home/search?q=revenue",
    });
  });

  it("resolves a collection's own page separately", () => {
    const route = resolveRoute("/collection/col_123/Revenue");
    expect(route.id).toBe("collection");
    expect(route.view).toBe("collections");
  });

  it.each(["/context-studio", "/context-studio/setup"])(
    "opens the backed Context Studio Setup view at %s",
    (path) => {
      const route = resolveRoute(path);
      expect(route).toMatchObject({ id: "context-studio", view: "setup" });
      expect(resolveRoutePage(route)).toBeDefined();
    },
  );
  it.each([
    "/welcome",
    "/onboarding",
    "/onboarding/prompt",
    "/org-selector",
    "/workspace-picker/choose",
    "/verify-org-domain",
    "/sent",
    "/createUser",
    "/link",
    "/link/abc/logged-in",
    "/link/abc/wrong-user",
    "/app/redirected",
    "/component-library",
  ])(
    "sends a signed-in session from the page-less landing URL %s to Home instead of an empty frame",
    (path) => {
      expect(resolveRoute(path)).toMatchObject({
        frame: "redirect",
        to: "/home",
      });
      expect(resolveRoute(`${path}?next=%2Fhome%2Fall`)).toMatchObject({
        frame: "redirect",
        to: "/home",
      });
    },
  );
  it("keeps the OAuth callback landing pages out of the Home redirect", () => {
    expect(resolveRoute("/bigquery-oauth-success").frame).toBe("callback");
  });
  it("keeps /welcome for an admin whose signup is incomplete", () => {
    const route = resolveRoute("/welcome", {
      isAdmin: true,
      signupComplete: false,
    });
    expect(route).toMatchObject({ frame: "onboarding", view: "welcome" });
  });
  it("still shows sign-in to a signed-out visitor on a landing URL", () => {
    expect(
      resolveRoute("/org-selector", { authenticated: false }),
    ).toMatchObject({ frame: "authentication", view: "login" });
  });
});
