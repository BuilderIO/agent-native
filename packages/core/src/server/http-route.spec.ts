import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FRAMEWORK_HTTP_ROUTES,
  HTTP_ROUTE_BUCKETS,
  httpRouteForRequest,
} from "./http-route.js";

function routeFor(pathname: string, method = "GET", matchedRoute?: unknown) {
  return httpRouteForRequest({ method, pathname, matchedRoute });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("httpRouteForRequest", () => {
  it("maps framework endpoints to their templates", () => {
    expect(routeFor("/_agent-native/auth/session")).toBe(
      "/_agent-native/auth/session",
    );
    expect(routeFor("/_agent-native/auth/session/")).toBe(
      "/_agent-native/auth/session",
    );
    expect(routeFor("/_agent-native/poll")).toBe("/_agent-native/poll");
    expect(routeFor("/_agent-native/events")).toBe("/_agent-native/events");
    expect(routeFor("/_agent-native/agent-chat", "POST")).toBe(
      "/_agent-native/agent-chat",
    );
    expect(routeFor("/_agent-native/a2a", "POST")).toBe("/_agent-native/a2a");
    expect(routeFor("/mcp", "POST")).toBe("/mcp");
    expect(routeFor("/_agent-native/mcp", "POST")).toBe("/_agent-native/mcp");
    expect(routeFor("/.well-known/agent-card.json")).toBe(
      "/.well-known/agent-card.json",
    );
  });

  it("collapses ids and subpaths into the template that owns them", () => {
    expect(
      routeFor(
        "/_agent-native/agent-chat/runs/run-1783002639448-8rptjt/events",
      ),
    ).toBe("/_agent-native/agent-chat/runs/:runId/events");
    expect(routeFor("/_agent-native/agent-chat/runs/turn/t_1/abort")).toBe(
      "/_agent-native/agent-chat/runs/*",
    );
    expect(
      routeFor("/_agent-native/agent-chat/threads/thread_8f2a91/messages"),
    ).toBe("/_agent-native/agent-chat/threads/*");
    expect(routeFor("/_agent-native/application-state/navigation")).toBe(
      "/_agent-native/application-state/:key",
    );
    expect(routeFor("/_agent-native/application-state/compose/draft-1")).toBe(
      "/_agent-native/application-state/compose/*",
    );
    expect(routeFor("/_agent-native/actions/list-customer-secrets")).toBe(
      "/_agent-native/actions/:action",
    );
    expect(routeFor("/_agent-native/auth/ba/get-session")).toBe(
      "/_agent-native/auth/ba/*",
    );
    expect(routeFor("/_agent-native/auth/magic-link/new-user")).toBe(
      "/_agent-native/auth/*",
    );
    expect(routeFor("/_agent-native/integrations/slack/webhook", "POST")).toBe(
      "/_agent-native/integrations/:platform/webhook",
    );
    expect(routeFor("/_agent-native/integrations/remote/heartbeat")).toBe(
      "/_agent-native/integrations/remote/heartbeat",
    );
    expect(routeFor("/_agent-native/org/members/alice@example.com")).toBe(
      "/_agent-native/org/*",
    );
    expect(routeFor("/mcp/tool/protected-report", "POST")).toBe(
      "/mcp/tool/:action",
    );
    expect(routeFor("/.well-known/oauth-protected-resource/mcp")).toBe(
      "/.well-known/oauth-protected-resource/*",
    );
  });

  it("buckets unknown framework, MCP, and well-known paths by namespace", () => {
    expect(routeFor("/_agent-native/not-a-route/customer-secret")).toBe(
      "/_agent-native/*",
    );
    expect(routeFor("/_agent-native/poll/extra")).toBe("/_agent-native/*");
    expect(routeFor("/mcp/unknown/customer-secret")).toBe("/mcp/*");
    expect(routeFor("/.well-known/customer-secret.txt")).toBe("/.well-known/*");
  });

  it("strips the app base path and a custom public framework prefix", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/docs");
    expect(routeFor("/docs/_agent-native/auth/session")).toBe(
      "/_agent-native/auth/session",
    );
    vi.stubEnv("AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX", "/_an");
    expect(routeFor("/docs/_an/poll")).toBe("/_agent-native/poll");
  });

  it("uses the app's matched Nitro file route, never Nitro's catch-all", () => {
    expect(routeFor("/api/clips/clip_8f2a91", "GET", "/api/clips/:id")).toBe(
      "/api/clips/:id",
    );
    expect(routeFor("/api/clips/clip_8f2a91", "GET", "/**")).toBe("/api/*");
    expect(routeFor("/api/clips/clip_8f2a91", "GET")).toBe("/api/*");
    expect(routeFor("/reports/42", "GET", "/**")).toBe("page");
  });

  it("buckets everything else as static, page, or other", () => {
    expect(routeFor("/assets/index-Bx1.js")).toBe("static");
    expect(routeFor("/favicon.ico")).toBe("static");
    expect(routeFor("/")).toBe("page");
    expect(routeFor("/reports/42")).toBe("page");
    expect(routeFor("/reports/42.data")).toBe("page");
    expect(routeFor("/reports/42", "HEAD")).toBe("page");
    expect(routeFor("/reports/42", "POST")).toBe("other");
  });

  it("only ever returns a value from the closed set", () => {
    const allowed = new Set<string>([
      ...FRAMEWORK_HTTP_ROUTES,
      ...HTTP_ROUTE_BUCKETS,
    ]);
    const randomPaths = Array.from({ length: 200 }, (_, index) => {
      const id = `${index}-${Math.random().toString(36).slice(2)}`;
      return [
        `/_agent-native/${id}`,
        `/_agent-native/agent-chat/runs/${id}/events`,
        `/_agent-native/application-state/${id}`,
        `/_agent-native/actions/${id}/${id}`,
        `/mcp/${id}`,
        `/.well-known/${id}`,
        `/api/${id}`,
        `/${id}`,
        `/${id}.png`,
      ];
    }).flat();
    const routes = new Set(
      randomPaths.flatMap((path) => [
        routeFor(path, "GET"),
        routeFor(path, "POST"),
      ]),
    );
    for (const route of routes) expect(allowed).toContain(route);
    expect(allowed.size).toBeLessThan(100);
  });
});
