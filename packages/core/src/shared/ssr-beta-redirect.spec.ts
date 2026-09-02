import { describe, expect, it } from "vitest";

import {
  BETA_FORCE_SESSION_STORAGE_KEY,
  BETA_OPT_OUT_STORAGE_KEY,
  BETA_REDIRECT_SIGN_OUT_STORAGE_KEY,
  BETA_REDIRECT_STORAGE_KEY,
} from "./environment-lanes.js";
import {
  getSsrBetaRedirectScript,
  getSsrBetaRedirectScriptBody,
  SSR_BETA_REDIRECT_MARKER,
} from "./ssr-beta-redirect.js";

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function runScript({
  href,
  embedded = false,
  localStorage = createStorage(),
  sessionStorage = createStorage(),
  userAgent = "",
  session = { email: "employee@builder.io" },
  sessionResponseOk = true,
  sessionPath = "/_agent-native/auth/session",
  sessionProbe,
}: {
  href: string | { current: string };
  embedded?: boolean;
  localStorage?: ReturnType<typeof createStorage>;
  sessionStorage?: ReturnType<typeof createStorage>;
  userAgent?: string;
  session?: Record<string, unknown> | null;
  sessionResponseOk?: boolean;
  sessionPath?: string;
  sessionProbe?: Promise<Record<string, unknown> | null>;
}) {
  const result = {
    fetched: [] as string[],
    historyUrl: null as string | null,
    redirectedTo: null as string | null,
  };
  const hrefRef = typeof href === "string" ? { current: href } : href;
  const url = new URL(hrefRef.current);
  const window = {
    history: {
      replaceState(_state: unknown, _title: string, value: string) {
        result.historyUrl = value;
      },
    },
    location: {
      get hostname() {
        return new URL(hrefRef.current).hostname;
      },
      get href() {
        return hrefRef.current;
      },
      replace(value: string) {
        result.redirectedTo = value;
      },
    },
    localStorage,
    navigator: { userAgent },
    parent: null as unknown,
    sessionStorage,
  } as Record<string, unknown>;
  window.parent = embedded ? {} : window;

  const fetch = async (input: string) => {
    result.fetched.push(input);
    const responseSession = sessionProbe ? await sessionProbe : session;
    return {
      ok: sessionResponseOk,
      status: sessionResponseOk ? 200 : 503,
      json: async () => responseSession,
    };
  };
  window.fetch = fetch;

  new Function("window", "fetch", getSsrBetaRedirectScriptBody(sessionPath))(
    window,
    fetch,
  );

  return Promise.resolve()
    .then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
    .then(() => ({ ...result, localStorage, sessionStorage }));
}

describe("getSsrBetaRedirectScript", () => {
  it("redirects before the app bundle after revalidating the employee session", async () => {
    const localStorage = createStorage({
      [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000),
    });

    const result = await runScript({
      href: "http://plan.agent-native.com/inbox?tab=all#runs",
      localStorage,
    });

    expect(result.redirectedTo).toBe(
      "https://beta.plan.agent-native.com/inbox?tab=all#runs",
    );
    expect(result.fetched).toEqual(["/_agent-native/auth/session"]);
  });

  it("uses the mapped beta host for the workspace production alias", async () => {
    const result = await runScript({
      href: "https://builder-agent-native-workspace.netlify.app/inbox",
      localStorage: createStorage({
        [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000),
      }),
    });

    expect(result.redirectedTo).toBe(
      "https://beta.agent-workspace.builder.io/inbox",
    );
  });

  it.each([
    ["beta hosts", "https://beta.plan.agent-native.com/inbox", ""],
    ["unmapped hosts", "https://www.agent-native.com/inbox", ""],
    [
      "desktop sessions",
      "https://plan.agent-native.com/inbox",
      "AgentNativeDesktop/1",
    ],
  ])("does not redirect on %s", async (_name, href, userAgent) => {
    const result = await runScript({
      href,
      userAgent,
      localStorage: createStorage({
        [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000),
      }),
    });

    expect(result.redirectedTo).toBeNull();
  });

  it("does not redirect embedded sessions", async () => {
    const result = await runScript({
      embedded: true,
      href: "https://plan.agent-native.com/inbox",
      localStorage: createStorage({
        [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000),
      }),
    });

    expect(result.redirectedTo).toBeNull();
  });

  it("persists a force query guard for the rest of the browser session", async () => {
    const localStorage = createStorage({
      [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000),
    });
    const sessionStorage = createStorage();

    const forced = await runScript({
      href: "https://plan.agent-native.com/inbox?force=true",
      localStorage,
      sessionStorage,
    });
    const subsequent = await runScript({
      href: "https://plan.agent-native.com/inbox",
      localStorage,
      sessionStorage,
    });

    expect(forced.redirectedTo).toBeNull();
    expect(sessionStorage.getItem(BETA_FORCE_SESSION_STORAGE_KEY)).toBe("1");
    expect(subsequent.redirectedTo).toBeNull();
  });

  it("stores an active opt-out and clears the redirect marker before returning", async () => {
    const optOutExpiry = Date.now() + 60 * 60 * 1000;
    const localStorage = createStorage({
      [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000),
    });

    const result = await runScript({
      href: `https://plan.agent-native.com/inbox?tab=all&agentNativeBetaOptOut=${optOutExpiry}#runs`,
      localStorage,
    });

    expect(result.redirectedTo).toBeNull();
    expect(result.historyUrl).toBe(
      "https://plan.agent-native.com/inbox?tab=all#runs",
    );
    expect(localStorage.getItem(BETA_OPT_OUT_STORAGE_KEY)).toBe(
      String(optOutExpiry),
    );
    expect(localStorage.getItem(BETA_REDIRECT_STORAGE_KEY)).toBeNull();
  });

  it("honors an active stored opt-out without touching the redirect marker", async () => {
    const localStorage = createStorage({
      [BETA_OPT_OUT_STORAGE_KEY]: String(Date.now() + 60 * 60 * 1000),
      [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000),
    });

    const result = await runScript({
      href: "https://plan.agent-native.com/inbox",
      localStorage,
    });

    expect(result.redirectedTo).toBeNull();
    expect(localStorage.getItem(BETA_REDIRECT_STORAGE_KEY)).not.toBeNull();
  });

  it("clears expired redirect markers instead of redirecting", async () => {
    const localStorage = createStorage({
      [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() - 1),
    });

    const result = await runScript({
      href: "https://plan.agent-native.com/inbox",
      localStorage,
    });

    expect(result.redirectedTo).toBeNull();
    expect(localStorage.getItem(BETA_REDIRECT_STORAGE_KEY)).toBeNull();
  });

  it("fails open when browser storage is unavailable", async () => {
    const deniedStorage = {
      getItem() {
        throw new Error("storage denied");
      },
      removeItem() {
        throw new Error("storage denied");
      },
      setItem() {
        throw new Error("storage denied");
      },
    };

    const result = await runScript({
      href: "https://plan.agent-native.com/inbox",
      localStorage: deniedStorage,
    });

    expect(result.redirectedTo).toBeNull();
  });

  it("clears a stale marker when the current session is signed out", async () => {
    const localStorage = createStorage({
      [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000),
    });

    const result = await runScript({
      href: "https://plan.agent-native.com/inbox",
      localStorage,
      session: { error: "Not authenticated" },
    });

    expect(result.redirectedTo).toBeNull();
    expect(result.fetched).toEqual(["/_agent-native/auth/session"]);
    expect(localStorage.getItem(BETA_REDIRECT_STORAGE_KEY)).toBeNull();
  });

  it("invalidates the production marker after beta sign-out before returning", async () => {
    const productionStorage = createStorage({
      [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000),
    });
    const betaStorage = createStorage();

    const redirected = await runScript({
      href: "https://plan.agent-native.com/inbox",
      localStorage: productionStorage,
    });
    expect(redirected.redirectedTo).toBe(
      "https://beta.plan.agent-native.com/inbox",
    );
    expect(productionStorage.getItem(BETA_REDIRECT_STORAGE_KEY)).not.toBeNull();

    const betaSignOut = await runScript({
      href: "https://beta.plan.agent-native.com/inbox",
      localStorage: betaStorage,
    });
    expect(betaSignOut.redirectedTo).toBeNull();
    expect(betaSignOut.fetched).toEqual([]);

    const returned = await runScript({
      href: "https://plan.agent-native.com/inbox",
      localStorage: productionStorage,
      session: { error: "Not authenticated" },
    });
    expect(returned.redirectedTo).toBeNull();
    expect(returned.fetched).toEqual(["/_agent-native/auth/session"]);
    expect(productionStorage.getItem(BETA_REDIRECT_STORAGE_KEY)).toBeNull();
  });

  it("clears a marker when the current session belongs to a non-Builder user", async () => {
    const localStorage = createStorage({
      [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000),
    });

    const result = await runScript({
      href: "https://plan.agent-native.com/inbox",
      localStorage,
      session: { email: "customer@example.com" },
    });

    expect(result.redirectedTo).toBeNull();
    expect(localStorage.getItem(BETA_REDIRECT_STORAGE_KEY)).toBeNull();
  });

  it("fails open and retains the marker when the session probe is unavailable", async () => {
    const localStorage = createStorage({
      [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000),
    });

    const result = await runScript({
      href: "https://plan.agent-native.com/inbox",
      localStorage,
      sessionResponseOk: false,
    });

    expect(result.redirectedTo).toBeNull();
    expect(localStorage.getItem(BETA_REDIRECT_STORAGE_KEY)).not.toBeNull();
  });

  it("does not navigate after sign-out starts while the session probe is pending", async () => {
    const localStorage = createStorage({
      [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000),
    });
    const sessionStorage = createStorage();
    let resolveProbe: ((session: Record<string, unknown>) => void) | undefined;
    const sessionProbe = new Promise<Record<string, unknown>>((resolve) => {
      resolveProbe = resolve;
    });

    const pending = runScript({
      href: "https://plan.agent-native.com/inbox",
      localStorage,
      sessionStorage,
      sessionProbe,
    });
    await Promise.resolve();
    sessionStorage.setItem(BETA_REDIRECT_SIGN_OUT_STORAGE_KEY, "1");
    resolveProbe!({ email: "employee@builder.io" });

    const result = await pending;

    expect(result.redirectedTo).toBeNull();
  });

  it("uses the current URL after a delayed session probe", async () => {
    const localStorage = createStorage({
      [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000),
    });
    const href = { current: "https://plan.agent-native.com/inbox?tab=all" };
    let resolveProbe: ((session: Record<string, unknown>) => void) | undefined;
    const sessionProbe = new Promise<Record<string, unknown>>((resolve) => {
      resolveProbe = resolve;
    });

    const pending = runScript({ href, localStorage, sessionProbe });
    await Promise.resolve();
    href.current =
      "https://plan.agent-native.com/settings?tab=profile#security";
    resolveProbe!({ email: "employee@builder.io" });

    const result = await pending;

    expect(result.redirectedTo).toBe(
      "https://beta.plan.agent-native.com/settings?tab=profile#security",
    );
  });

  it("emits a marked inline script for head or shell injection", () => {
    const script = getSsrBetaRedirectScript();

    expect(script).toContain(SSR_BETA_REDIRECT_MARKER);
    expect(script).toContain(BETA_REDIRECT_STORAGE_KEY);
    expect(script).toContain("/_agent-native/auth/session");
    expect(script).not.toContain("document.cookie");
  });

  it("escapes a session probe path before embedding it in HTML", () => {
    const script = getSsrBetaRedirectScript(
      "/</script><script>window.__injected=1</script>/_agent-native/auth/session",
    );

    expect(script).toContain("\\u003c/script\\u003e\\u003cscript\\u003e");
    expect(script).not.toContain("</script><script>window.__injected=1");
  });
});
