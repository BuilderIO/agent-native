import {
  UNSAFE_decodeViaTurboStream,
  UNSAFE_SingleFetchRedirectSymbol,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import { signInLandingLoader } from "../client/sign-in-landing.js";
import { decodeContinuation } from "../shared/sign-in-journey.js";
import { createH3SSRHandler } from "./ssr-handler.js";

function createHandler(homePath?: string) {
  const loader = homePath
    ? ({ request }: { request: Request }) =>
        signInLandingLoader(homePath, request)
    : signInLandingLoader;
  const build = {
    entry: {
      module: {
        default: () =>
          new Response("<html><head></head><body>home</body></html>", {
            headers: { "content-type": "text/html" },
          }),
      },
    },
    routes: {
      root: { id: "root", path: "", module: { default: () => null } },
      index: {
        id: "index",
        parentId: "root",
        index: true,
        module: { loader, default: () => null },
      },
    },
    assets: { routes: {} },
    future: {},
    ssr: true,
    prerender: [],
    routeDiscovery: { mode: "initial", manifestPath: "/__manifest" },
  };
  const handler = createH3SSRHandler(() => build) as unknown as (event: {
    url: URL;
    req: Request;
  }) => Promise<Response>;
  return (path: string) => {
    const url = new URL(path, "https://app.example.test");
    return handler({ url, req: new Request(url) });
  };
}

async function dataRedirect(response: Response) {
  expect(response.status).toBe(202);
  expect(response.headers.get("content-type")).toContain("text/x-script");
  if (!response.body) throw new Error("Missing single-fetch response body");
  const decoded = await UNSAFE_decodeViaTurboStream(response.body, globalThis);
  return decoded.value[UNSAFE_SingleFetchRedirectSymbol] as {
    redirect: string;
    status: number;
    reload: boolean;
  };
}

describe("landing redirects through the SSR router", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    defineAppConfig({ app: { homePath: "/home" } });
    vi.stubEnv("APP_BASE_PATH", "");
    vi.stubEnv("VITE_APP_BASE_PATH", "");
  });

  afterEach(() => {
    resetAppConfigForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    { mount: "/programs", data: "/programs.data", document: "/programs/" },
    { mount: "", data: "/_.data", document: "/" },
  ])(
    "keeps single-fetch redirects relative and document redirects mounted ($mount)",
    async ({ mount, data, document }) => {
      vi.stubEnv("VITE_APP_BASE_PATH", mount);
      const request = createHandler();

      expect(await dataRedirect(await request(data))).toMatchObject({
        redirect: "/sign-in",
        status: 302,
        reload: true,
      });
      const response = await request(document);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(`${mount}/sign-in`);
      expect(response.headers.get("X-Remix-Reload-Document")).toBe("true");
    },
  );

  it("preserves separate server sign-in and mounted UI home continuations", async () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/programs");
    vi.stubGlobal("__AGENT_NATIVE_APP_CONFIG__", {
      runtime: { apiBaseUrl: "https://api.example.test/auth-app" },
    });
    const request = createHandler("/dashboard");
    const singleFetch = await dataRedirect(await request("/programs.data"));
    const document = await request("/programs/");
    expect(document.status).toBe(302);
    expect(document.headers.get("location")).toBe(singleFetch.redirect);
    expect(singleFetch.reload).toBe(true);
    const target = new URL(singleFetch.redirect);
    expect(target.origin + target.pathname).toBe(
      "https://api.example.test/auth-app/sign-in",
    );
    const continuation = decodeContinuation(
      target.searchParams.get("c"),
      "/auth-app",
    );
    if (continuation === null) throw new Error("Missing server continuation");
    const hop = new URL(continuation, target.origin);
    expect(hop.pathname).toBe("/auth-app/_agent-native/auth/ui-return");
    expect(hop.searchParams.get("to")).toBe(
      "https://app.example.test/programs/dashboard",
    );
  });

  it("renders the root when homePath is explicitly root", async () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/programs");
    const response = await createHandler("/")("/programs/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<body>home</body>");
  });
});
