import { H3, H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signInJourney } from "../shared/sign-in-journey.js";
import { getH3App } from "./framework-request-handler.js";

vi.mock("../deploy/route-discovery.js", () => ({
  getMissingDefaultPlugins: vi.fn(async () => []),
}));
import {
  autoMountAuth,
  authSessionHandler,
  registerAuthPublicPaths,
  type AuthOptions,
} from "./auth.js";

function request(rawPath: string, method = "POST", node = true): Request {
  const req = new Request(`http://localhost${rawPath}`, {
    method,
    headers: { accept: "application/json" },
  });
  if (node) {
    Object.defineProperty(req, "runtime", {
      value: { node: { req: { url: rawPath, method } } },
    });
  }
  return req;
}

async function harness(options: AuthOptions = {}, earlySession = false) {
  const app = new H3();
  const scope = getH3App({ h3: app });
  const guardPaths: string[] = [];
  scope.use((event) => {
    guardPaths.push(event.url.pathname);
  });
  if (earlySession)
    scope.use("/_agent-native/auth/session", authSessionHandler);
  await autoMountAuth(scope, { getSession: async () => null, ...options });
  registerAuthPublicPaths(["/api/exact"], scope);
  const reached = vi.fn((event: H3Event) => ({ path: event.url.pathname }));
  app.all("/**", reached);
  return { app, reached, guardPaths };
}

describe("auth guard routed paths", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_DISABLED", "");
    vi.stubEnv("ACCESS_TOKEN", "");
    vi.stubEnv("APP_BASE_PATH", "");
    vi.stubEnv("VITE_APP_BASE_PATH", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const families: Array<{
    name: string;
    publicPath: string;
    method?: string;
    options?: AuthOptions;
    suffix?: string;
  }> = [
    { name: "auth prefix", publicPath: "/_agent-native/auth/probe" },
    {
      name: "shared chat prefix",
      publicPath: "/_agent-native/agent-chat/shared/probe",
    },
    {
      name: "publicPaths prefix",
      publicPath: "/public/item",
      options: { publicPaths: ["/public"] },
    },
    {
      name: "publicPaths parameter",
      publicPath: "/public/item",
      options: { publicPaths: ["/public/:id"] },
    },
    {
      name: "query-token paths",
      publicPath: "/public/item",
      options: {
        publicPathsWithQueryToken: [
          { path: "/public/:id", queryParam: "token" },
        ],
      },
    },
    {
      name: "public workspace GET",
      publicPath: "/public/item",
      method: "GET",
      options: {
        workspaceAppAudience: "public",
        workspaceAppPublicPaths: ["/public"],
      },
    },
    { name: "SSR shell", publicPath: "/documents/item", method: "GET" },
    { name: "static prefix", publicPath: "/assets/item" },
    { name: "static suffix", publicPath: "/bundle.js", suffix: "#bundle.js" },
    {
      name: "integration webhook",
      publicPath: "/_agent-native/integrations/probe/webhook",
    },
    {
      name: "automation webhook",
      publicPath: "/_agent-native/automations/webhook/probe",
    },
    { name: "exact framework paths", publicPath: "/_agent-native/health" },
    { name: "exact registered paths", publicPath: "/api/exact" },
    { name: "Builder Connect", publicPath: "/_agent-native/builder/relay" },
  ];

  it.each(families)(
    "checks non-canonical paths before $name",
    async ({ publicPath, method = "POST", options, suffix = "" }) => {
      const { app, reached } = await harness(options);
      const query = "?token=scoped-token";
      const canonical = request(`${publicPath}${query}`, method);
      if (publicPath.startsWith("/documents/"))
        canonical.headers.set("accept", "text/html");
      expect((await app.request(canonical)).status).toBe(200);

      const segments = publicPath.split("/").filter(Boolean).length;
      for (const [separator, parent] of [
        ["/", ".."],
        ["\\", ".."],
        ["/", "%2e%2e"],
      ]) {
        const raw = `${publicPath}${separator}${Array(segments).fill(parent).join(separator)}${separator}api${separator}private${suffix}${query}`;
        const req = request(raw, method);
        const routed = new H3Event(req).url.pathname;
        expect(routed).toBe("/api/private");
        const response = await app.request(req);
        expect(response.status, raw).toBe(400);
      }
      expect((await app.request(request("/api/private", method))).status).toBe(
        401,
      );
      expect(reached).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["/portal", "/org/apps/content"])(
    "checks routed paths under %s",
    async (base) => {
      vi.stubEnv("APP_BASE_PATH", base);
      const { app, guardPaths } = await harness({
        publicPaths: ["/public/:id"],
      });
      expect((await app.request(request(`${base}/public/item`))).status).toBe(
        200,
      );
      expect((await app.request(request(`${base}/api/private`))).status).toBe(
        401,
      );
      expect(guardPaths).toEqual([
        `${base}/public/item`,
        `${base}/api/private`,
      ]);
      for (const segment of ["..", "%2e%2e", ".%2E"]) {
        expect(
          (await app.request(request(`${base}/public/${segment}/api/private`)))
            .status,
        ).toBe(400);
      }
      expect(
        (await app.request(request(`${base}/public/..\\api\\private`))).status,
      ).toBe(400);
    },
  );

  it("checks public and private paths inside an h3 workspace mount", async () => {
    const base = "/org/apps/content";
    vi.stubEnv("APP_BASE_PATH", base);
    const { app, guardPaths } = await harness({ publicPaths: ["/public/:id"] });
    const workspace = new H3();
    workspace.mount(base, app);
    expect(
      (await workspace.request(request(`${base}/public/item`))).status,
    ).toBe(200);
    expect(
      (await workspace.request(request(`${base}/api/private`))).status,
    ).toBe(401);
    expect(guardPaths).toEqual(["/public/item", "/api/private"]);
  });

  it("preserves encoded delimiters in sign-in return paths", () => {
    const path = "/documents/item%3Fsection%23part?view=compact&next=%23hash";
    const event = new H3Event(request(path, "GET"));
    expect(event.url.pathname).toBe("/documents/item%3Fsection%23part");
    expect(
      signInJourney({ at: `${event.url.pathname}${event.url.search}` })
        .resumeHref,
    ).toBe(path);
  });

  it("classifies h3 pathname normalization without Node transport metadata", async () => {
    const { app } = await harness();
    const req = request("/documents/../api/%70rivate", "GET", false);
    expect(new H3Event(req).url.pathname).toBe("/api/private");
    expect((await app.request(req)).status).toBe(401);
  });

  it.each(["/mcp/directory", "/public/item"])(
    "checks non-canonical paths before CORS for %s",
    async (path) => {
      const { app } = await harness({ publicCorsPaths: ["/public"] });
      const canonical = request(path, "OPTIONS");
      canonical.headers.set("origin", "https://chatgpt.com");
      expect((await app.request(canonical)).status).toBe(204);
      for (const [separator, parent] of [
        ["/", ".."],
        ["\\", ".."],
        ["/", "%2e%2e"],
      ]) {
        const raw = `${path}${separator}${parent}${separator}${parent}${separator}api${separator}private`;
        const req = request(raw, "OPTIONS");
        req.headers.set("origin", "https://chatgpt.com");
        expect(new H3Event(req).url.pathname).toBe("/api/private");
        const response = await app.request(req);
        expect(response.status).toBe(400);
        expect(response.headers.has("access-control-allow-origin")).toBe(false);
      }
    },
  );

  it("keeps encoded separators inside route parameters", async () => {
    const { app } = await harness({
      publicPaths: ["/page/:id", "/api/video/:id"],
    });
    for (const path of [
      "/page/github%3Aowner%2Frepo%2Fdocs",
      "/page/local-source-folder%3AC%253A%255Cdocs",
      "/api/video/folder%2Frecording",
      "/api/video/folder%5Crecording",
      "/page/readme%2emd",
    ]) {
      const response = await app.request(request(path));
      expect(response.status, path).toBe(200);
      expect(await response.json()).toEqual({
        path: new H3Event(request(path)).url.pathname,
      });
    }
    expect((await app.request(request("/api/private%2Fitem"))).status).toBe(
      401,
    );
  });

  it("uses h3's pathname for encoded public path characters", async () => {
    const { app } = await harness({ publicPaths: ["/api/public"] });
    expect((await app.request(request("/api/%70ublic"))).status).toBe(200);
    expect((await app.request(request("/api/%70rivate"))).status).toBe(401);
  });

  it("checks non-canonical paths before auth CORS and auth routes", async () => {
    const { app } = await harness();
    for (const method of ["OPTIONS", "GET"]) {
      const canonical = await app.request(
        request("/_agent-native/auth/session", method),
      );
      expect(canonical.status).toBe(method === "OPTIONS" ? 204 : 200);
      for (const path of [
        "/_agent-native/auth/x/../session",
        "/_agent-native/auth/x\\..\\session",
        "/_agent-native/auth/x/%2e%2e/session",
      ]) {
        expect((await app.request(request(path, method))).status).toBe(400);
      }
    }
  });

  it("checks non-canonical paths at the early session handler", async () => {
    const { app } = await harness({}, true);
    for (const method of ["GET", "OPTIONS"]) {
      const canonical = await app.request(
        request("/_agent-native/auth/session", method),
      );
      expect(canonical.status).toBe(method === "GET" ? 200 : 405);
      for (const path of [
        "/_agent-native/auth/x/../session",
        "/_agent-native/auth/x\\..\\session",
        "/_agent-native/auth/x/%2e%2e/session",
      ]) {
        expect((await app.request(request(path, method))).status).toBe(400);
      }
    }
  });
});
