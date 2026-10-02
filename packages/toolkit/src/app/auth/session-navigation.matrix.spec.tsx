// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cold page loads across every answer the session endpoint can give, on every
 * client the code distinguishes, with the real head scripts (session
 * bootstrap, beta lane), the real page-wide session store, and the real gate.
 * Each load gets a fresh module graph, like a fresh document.
 *
 * Invariants:
 *  (a) only a definitive signed-out answer (401 or the signed-out body)
 *      navigates to sign-in;
 *  (b) once a load is authenticated, nothing later sends it to sign-in;
 *  (c) at most one navigation per page load;
 *  (d) an unavailable endpoint never navigates; it shows a retry notice.
 */

type Endpoint =
  | "ok"
  | "slow-ok"
  | "signed-out"
  | "http-401"
  | "failed-503"
  | "timeout";
type Client = "web" | "desktop" | "preview-iframe";

const SESSION_PATH = "/_agent-native/auth/session";
const PERSON = { userId: "user-1", email: "person@example.com" };
const EMPLOYEE = { userId: "user-2", email: "employee@builder.io" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function endpoint(kind: Endpoint, session: typeof PERSON) {
  return (): Promise<Response> => {
    switch (kind) {
      case "ok":
        return Promise.resolve(json(session));
      case "slow-ok":
        return new Promise((resolve) =>
          setTimeout(() => resolve(json(session)), 4_000),
        );
      case "signed-out":
        return Promise.resolve(json({ error: "Not authenticated" }));
      case "http-401":
        return Promise.resolve(json({ error: "Unauthorized" }, 401));
      case "failed-503":
        return Promise.resolve(json({ error: "Session unavailable" }, 503));
      case "timeout":
        return new Promise(() => {});
    }
  };
}

interface PageLoad {
  endpoint: Endpoint;
  client: Client;
  hint?: boolean;
  href?: string;
  session?: typeof PERSON;
  laneMarker?: boolean;
  afterLoad?: (
    session: typeof import("@agent-native/core/client/use-session"),
  ) => void;
  afterLoadEndpoint?: Endpoint;
}

interface PageResult {
  navigations: string[];
  appRendered: boolean;
  /** Whether the app had rendered when the first navigation went out. */
  appRenderedAtNavigation: boolean | undefined;
  /** Whether the app had rendered 1.5 s in, inside the navigation stall window. */
  appRenderedWithinStall: boolean;
  appVisibleAtEnd: boolean;
  sessionRequests: number;
  text: string;
}

let replaceMock: ReturnType<typeof vi.fn>;
const originals = {
  location: window.location,
  parent: window.parent,
  userAgent: window.navigator.userAgent,
};

beforeEach(() => {
  vi.useFakeTimers();
  replaceMock = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originals.location,
  });
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: originals.parent,
  });
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: originals.userAgent,
  });
  delete (document as { cookie?: string }).cookie;
  delete window.__agentNativeNavigationStarted;
  delete window.__agentNativeSessionBootstrap;
  delete (window as { __agentNativeBetaRedirectStarted?: boolean })
    .__agentNativeBetaRedirectStarted;
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.body.innerHTML = "";
});

async function loadPage(page: PageLoad): Promise<PageResult> {
  vi.resetModules();
  // The mocked replace never unloads the document, like a cancelled navigation.
  let appRendered = false;
  let appRenderedAtNavigation: boolean | undefined;
  replaceMock.mockImplementation(() => {
    appRenderedAtNavigation ??= appRendered;
  });
  const url = new URL(page.href ?? "https://app.example.com/inbox?tab=all");
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href: url.href,
      origin: url.origin,
      protocol: url.protocol,
      host: url.host,
      hostname: url.hostname,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      replace: replaceMock,
      assign: vi.fn(),
      reload: vi.fn(),
    },
  });
  if (page.client === "desktop") {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 AgentNativeDesktop/1.0",
    });
  }
  if (page.client === "preview-iframe") {
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: { postMessage: vi.fn() },
    });
  }
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => (page.hint ? "an_session_hint=1" : ""),
    set: () => {},
  });
  if (page.laneMarker) {
    window.localStorage.setItem(
      "agent-native:beta-redirect-until",
      String(Date.now() + 60_000),
    );
  }

  let respond = endpoint(page.endpoint, page.session ?? PERSON);
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    if (!String(input).includes(SESSION_PATH)) {
      return Promise.resolve(json({}));
    }
    return respond();
  });
  vi.stubGlobal("fetch", fetchMock);

  // The shell's head scripts, in AppProviders' order.
  const { getSsrSessionBootstrapScriptBody } =
    await import("@agent-native/core/shared/ssr-session-bootstrap");
  const { getSsrBetaRedirectScriptBody } =
    await import("@agent-native/core/shared/ssr-beta-redirect");
  new Function(getSsrSessionBootstrapScriptBody(SESSION_PATH))();
  new Function(getSsrBetaRedirectScriptBody(SESSION_PATH))();

  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const { RequireSession } = await import("./RequireSession.js");
  const sessionModule = await import("@agent-native/core/client/use-session");

  function App() {
    appRendered = true;
    return React.createElement("div", { "data-testid": "app" }, "app");
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => {
    root.render(
      React.createElement(RequireSession, null, React.createElement(App)),
    );
  });
  let appRenderedWithinStall = false;
  for (let elapsed = 0; elapsed < 45_000; elapsed += 500) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    if (elapsed + 500 === 1_500) appRenderedWithinStall = appRendered;
  }
  if (page.afterLoad) {
    if (page.afterLoadEndpoint) {
      respond = endpoint(page.afterLoadEndpoint, page.session ?? PERSON);
    }
    await act(async () => {
      page.afterLoad?.(sessionModule);
    });
    for (let elapsed = 0; elapsed < 45_000; elapsed += 500) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
    }
  }

  const result: PageResult = {
    navigations: replaceMock.mock.calls.map((call) => String(call[0])),
    appRendered,
    appRenderedAtNavigation,
    appRenderedWithinStall,
    appVisibleAtEnd: container.querySelector('[data-testid="app"]') !== null,
    sessionRequests: fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes(SESSION_PATH),
    ).length,
    text: container.textContent ?? "",
  };
  await act(async () => root.unmount());
  return result;
}

const ENDPOINTS: Endpoint[] = [
  "ok",
  "slow-ok",
  "signed-out",
  "http-401",
  "failed-503",
  "timeout",
];
const CLIENTS: Client[] = ["web", "desktop", "preview-iframe"];
const SIGNED_OUT: Endpoint[] = ["signed-out", "http-401"];
const UNAVAILABLE: Endpoint[] = ["failed-503", "timeout"];

describe("session navigation matrix: cold load × endpoint × client × hint", () => {
  for (const client of CLIENTS) {
    for (const hint of [false, true]) {
      for (const kind of ENDPOINTS) {
        it(`${client}, ${hint ? "hint cookie" : "no hint"}, endpoint ${kind}`, async () => {
          const page = await loadPage({ endpoint: kind, client, hint });

          // (c) one navigation at most, whatever the endpoint says.
          expect(page.navigations.length).toBeLessThanOrEqual(1);

          if (SIGNED_OUT.includes(kind)) {
            // (a) a definitive signed-out answer goes to sign-in, once.
            expect(page.navigations).toHaveLength(1);
            expect(page.navigations[0]).toMatch(/^\/sign-in\?c=/);
            expect(page.appRendered).toBe(false);
            expect(page.sessionRequests).toBe(1);
          } else if (UNAVAILABLE.includes(kind)) {
            // (d) unavailable never navigates and never flashes the app;
            // a hint cookie with a failing probe included.
            expect(page.navigations).toEqual([]);
            expect(page.appRendered).toBe(false);
            expect(page.text).toContain("Retry connection");
          } else {
            expect(page.navigations).toEqual([]);
            expect(page.appVisibleAtEnd).toBe(true);
            expect(page.sessionRequests).toBe(1);
          }
        });
      }
    }
  }
});

describe("once authenticated, a load never leaves for sign-in (b)", () => {
  for (const later of ["failed-503", "timeout"] as const) {
    it(`keeps the app when a 401-triggered re-check finds the endpoint ${later}`, async () => {
      const page = await loadPage({
        endpoint: "ok",
        client: "web",
        afterLoadEndpoint: later,
        afterLoad: (session) => session.recheckSessionAfterUnauthorized(),
      });

      expect(page.navigations).toEqual([]);
      expect(page.appVisibleAtEnd).toBe(true);
    });
  }

  it("sends a load whose re-check is definitively signed out to sign-in once", async () => {
    const page = await loadPage({
      endpoint: "ok",
      client: "web",
      afterLoadEndpoint: "signed-out",
      afterLoad: (session) => {
        session.recheckSessionAfterUnauthorized();
        session.recheckSessionAfterUnauthorized();
      },
    });

    expect(page.navigations).toHaveLength(1);
    expect(page.navigations[0]).toMatch(/^\/sign-in\?c=/);
  });

  it("brings the app back when the page never left for sign-in and another tab signs in", async () => {
    const page = await loadPage({
      endpoint: "signed-out",
      client: "web",
      afterLoadEndpoint: "ok",
      afterLoad: (session) => session.notifySessionInvalidated(),
    });

    expect(page.navigations).toHaveLength(1);
    expect(page.navigations[0]).toMatch(/^\/sign-in\?c=/);
    expect(page.appVisibleAtEnd).toBe(true);
  });
});

describe("beta lane shares the probe and the one navigation", () => {
  const productionHref = "https://plan.agent-native.com/inbox";

  it("web: an authenticated employee with the lane marker moves once, before the app renders", async () => {
    const page = await loadPage({
      endpoint: "ok",
      client: "web",
      hint: true,
      href: productionHref,
      session: EMPLOYEE,
      laneMarker: true,
    });

    expect(page.navigations).toEqual([
      "https://beta.plan.agent-native.com/inbox",
    ]);
    // Never flashes the app while the switch is in flight. (This harness's
    // document never unloads, so the stall release later gives it back.)
    expect(page.appRenderedAtNavigation).toBe(false);
    expect(page.appRenderedWithinStall).toBe(false);
    expect(page.sessionRequests).toBe(1);
  });

  it("web: a lane switch the page never leaves on gives the app back after the stall window", async () => {
    const page = await loadPage({
      endpoint: "ok",
      client: "web",
      hint: true,
      href: productionHref,
      session: EMPLOYEE,
      laneMarker: true,
    });

    expect(page.navigations).toHaveLength(1);
    expect(page.appVisibleAtEnd).toBe(true);
  });

  for (const client of ["desktop", "preview-iframe"] as const) {
    it(`${client}: never switches lanes`, async () => {
      const page = await loadPage({
        endpoint: "ok",
        client,
        hint: true,
        href: productionHref,
        session: EMPLOYEE,
        laneMarker: true,
      });

      expect(page.navigations).toEqual([]);
      expect(page.appVisibleAtEnd).toBe(true);
    });
  }

  for (const kind of UNAVAILABLE) {
    it(`a lane marker with an ${kind} probe never navigates`, async () => {
      const page = await loadPage({
        endpoint: kind,
        client: "web",
        hint: true,
        href: productionHref,
        session: EMPLOYEE,
        laneMarker: true,
      });

      expect(page.navigations).toEqual([]);
      expect(page.text).toContain("Retry connection");
    });
  }

  it("a lane marker on a signed-out load goes to sign-in only", async () => {
    const page = await loadPage({
      endpoint: "signed-out",
      client: "web",
      hint: true,
      href: productionHref,
      session: EMPLOYEE,
      laneMarker: true,
    });

    expect(page.navigations).toHaveLength(1);
    expect(page.navigations[0]).toMatch(/^\/sign-in\?c=/);
  });
});
