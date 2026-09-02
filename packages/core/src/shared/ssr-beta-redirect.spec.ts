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

function createFailingStorage() {
  return {
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
}

function activeMarker() {
  return { [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000) };
}

function runScript({
  href,
  embedded = false,
  localStorage = createStorage(),
  sessionStorage = createStorage(),
  userAgent = "",
  signOutStarted = false,
}: {
  href: string;
  embedded?: boolean;
  localStorage?:
    | ReturnType<typeof createStorage>
    | ReturnType<typeof createFailingStorage>;
  sessionStorage?:
    | ReturnType<typeof createStorage>
    | ReturnType<typeof createFailingStorage>;
  userAgent?: string;
  signOutStarted?: boolean;
}) {
  const result = {
    fetched: [] as string[],
    historyUrl: null as string | null,
    redirectedTo: null as string | null,
  };
  const hrefRef = { current: href };
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
    ...(signOutStarted
      ? { __agentNativeBetaRedirectSignOutStarted: true }
      : {}),
  } as Record<string, unknown>;
  window.parent = embedded ? {} : window;

  // Recorded, never expected: an early redirect that reaches the network has
  // put a round trip back in front of the navigation this script exists to
  // make instant.
  window.fetch = (input: string) => {
    result.fetched.push(input);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  };

  new Function("window", getSsrBetaRedirectScriptBody())(window);

  return { ...result, localStorage, sessionStorage };
}

describe("getSsrBetaRedirectScript", () => {
  it("redirects synchronously without any network request", () => {
    const result = runScript({
      href: "https://plan.agent-native.com/projects/42?tab=activity#runs",
      localStorage: createStorage(activeMarker()),
    });

    expect(result.redirectedTo).toBe(
      "https://beta.plan.agent-native.com/projects/42?tab=activity#runs",
    );
    expect(result.fetched).toEqual([]);
  });

  it("uses the mapped beta host for the workspace production alias", () => {
    const result = runScript({
      href: "https://builder-agent-native-workspace.netlify.app/inbox",
      localStorage: createStorage(activeMarker()),
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
  ])("does not redirect on %s", (_name, href, userAgent) => {
    const result = runScript({
      href,
      userAgent,
      localStorage: createStorage(activeMarker()),
    });

    expect(result.redirectedTo).toBeNull();
  });

  it("does not redirect embedded sessions", () => {
    const result = runScript({
      embedded: true,
      href: "https://plan.agent-native.com/inbox",
      localStorage: createStorage(activeMarker()),
    });

    expect(result.redirectedTo).toBeNull();
  });

  it("does not redirect without a stored marker", () => {
    const result = runScript({
      href: "https://plan.agent-native.com/inbox",
    });

    expect(result.redirectedTo).toBeNull();
    expect(result.fetched).toEqual([]);
  });

  it("persists a force query guard for the rest of the browser session", () => {
    const sessionStorage = createStorage();
    const result = runScript({
      href: "https://plan.agent-native.com/inbox?force=true",
      localStorage: createStorage(activeMarker()),
      sessionStorage,
    });

    expect(result.redirectedTo).toBeNull();
    expect(sessionStorage.getItem(BETA_FORCE_SESSION_STORAGE_KEY)).toBe("1");
  });

  it("honors a stored force guard from earlier in the session", () => {
    const result = runScript({
      href: "https://plan.agent-native.com/inbox",
      localStorage: createStorage(activeMarker()),
      sessionStorage: createStorage({
        [BETA_FORCE_SESSION_STORAGE_KEY]: "1",
      }),
    });

    expect(result.redirectedTo).toBeNull();
  });

  it("stores an active opt-out and clears the redirect marker before returning", () => {
    const expiry = Date.now() + 60_000;
    const localStorage = createStorage(activeMarker());
    const result = runScript({
      href: `https://plan.agent-native.com/inbox?agentNativeBetaOptOut=${expiry}`,
      localStorage,
    });

    expect(result.redirectedTo).toBeNull();
    expect(localStorage.getItem(BETA_OPT_OUT_STORAGE_KEY)).toBe(String(expiry));
    expect(localStorage.getItem(BETA_REDIRECT_STORAGE_KEY)).toBeNull();
    expect(result.historyUrl).toBe("https://plan.agent-native.com/inbox");
  });

  it("honors an active stored opt-out without touching the redirect marker", () => {
    const localStorage = createStorage({
      ...activeMarker(),
      [BETA_OPT_OUT_STORAGE_KEY]: String(Date.now() + 60_000),
    });
    const result = runScript({
      href: "https://plan.agent-native.com/inbox",
      localStorage,
    });

    expect(result.redirectedTo).toBeNull();
    expect(localStorage.getItem(BETA_REDIRECT_STORAGE_KEY)).not.toBeNull();
  });

  it("clears expired redirect markers instead of redirecting", () => {
    const localStorage = createStorage({
      [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() - 1),
    });
    const result = runScript({
      href: "https://plan.agent-native.com/inbox",
      localStorage,
    });

    expect(result.redirectedTo).toBeNull();
    expect(localStorage.getItem(BETA_REDIRECT_STORAGE_KEY)).toBeNull();
  });

  it.each([
    ["an in-memory sign-out flag", true, createStorage()],
    [
      "a stored sign-out signal",
      false,
      createStorage({ [BETA_REDIRECT_SIGN_OUT_STORAGE_KEY]: "1" }),
    ],
  ])(
    "does not redirect during sign-out marked by %s",
    (_name, signOutStarted, sessionStorage) => {
      const result = runScript({
        href: "https://plan.agent-native.com/inbox",
        localStorage: createStorage(activeMarker()),
        sessionStorage,
        signOutStarted,
      });

      expect(result.redirectedTo).toBeNull();
    },
  );

  it("fails open when browser storage is unavailable", () => {
    const result = runScript({
      href: "https://plan.agent-native.com/inbox",
      localStorage: createFailingStorage(),
      sessionStorage: createFailingStorage(),
    });

    expect(result.redirectedTo).toBeNull();
  });

  it("emits a marked inline script for head or shell injection", () => {
    const script = getSsrBetaRedirectScript();

    expect(script.startsWith(`<script ${SSR_BETA_REDIRECT_MARKER}>`)).toBe(
      true,
    );
    expect(script.endsWith("</script>")).toBe(true);
    expect(script).toContain(BETA_REDIRECT_STORAGE_KEY);
  });
});
