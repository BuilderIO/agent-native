import { describe, expect, it } from "vitest";

import {
  BETA_FORCE_SESSION_STORAGE_KEY,
  BETA_OPT_OUT_STORAGE_KEY,
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
}: {
  href: string;
  embedded?: boolean;
  localStorage?: ReturnType<typeof createStorage>;
  sessionStorage?: ReturnType<typeof createStorage>;
  userAgent?: string;
}) {
  const result = {
    historyUrl: null as string | null,
    redirectedTo: null as string | null,
  };
  const url = new URL(href);
  const window = {
    history: {
      replaceState(_state: unknown, _title: string, value: string) {
        result.historyUrl = value;
      },
    },
    location: {
      hostname: url.hostname,
      href: url.toString(),
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

  new Function("window", getSsrBetaRedirectScriptBody())(window);

  return { ...result, localStorage, sessionStorage };
}

describe("getSsrBetaRedirectScript", () => {
  it("redirects synchronously with a prior verified-employee browser marker", () => {
    const localStorage = createStorage({
      [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000),
    });

    const result = runScript({
      href: "http://plan.agent-native.com/inbox?tab=all#runs",
      localStorage,
    });

    expect(result.redirectedTo).toBe(
      "https://beta.plan.agent-native.com/inbox?tab=all#runs",
    );
  });

  it("uses the mapped beta host for the workspace production alias", () => {
    const result = runScript({
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
  ])("does not redirect on %s", (_name, href, userAgent) => {
    const result = runScript({
      href,
      userAgent,
      localStorage: createStorage({
        [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000),
      }),
    });

    expect(result.redirectedTo).toBeNull();
  });

  it("does not redirect embedded sessions", () => {
    const result = runScript({
      embedded: true,
      href: "https://plan.agent-native.com/inbox",
      localStorage: createStorage({
        [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000),
      }),
    });

    expect(result.redirectedTo).toBeNull();
  });

  it("persists a force query guard for the rest of the browser session", () => {
    const localStorage = createStorage({
      [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000),
    });
    const sessionStorage = createStorage();

    const forced = runScript({
      href: "https://plan.agent-native.com/inbox?force=true",
      localStorage,
      sessionStorage,
    });
    const subsequent = runScript({
      href: "https://plan.agent-native.com/inbox",
      localStorage,
      sessionStorage,
    });

    expect(forced.redirectedTo).toBeNull();
    expect(sessionStorage.getItem(BETA_FORCE_SESSION_STORAGE_KEY)).toBe("1");
    expect(subsequent.redirectedTo).toBeNull();
  });

  it("stores an active opt-out and clears the redirect marker before returning", () => {
    const optOutExpiry = Date.now() + 60 * 60 * 1000;
    const localStorage = createStorage({
      [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000),
    });

    const result = runScript({
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

  it("honors an active stored opt-out without touching the redirect marker", () => {
    const localStorage = createStorage({
      [BETA_OPT_OUT_STORAGE_KEY]: String(Date.now() + 60 * 60 * 1000),
      [BETA_REDIRECT_STORAGE_KEY]: String(Date.now() + 60_000),
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

  it("fails open when browser storage is unavailable", () => {
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

    const result = runScript({
      href: "https://plan.agent-native.com/inbox",
      localStorage: deniedStorage,
    });

    expect(result.redirectedTo).toBeNull();
  });

  it("emits a marked inline script for head or shell injection", () => {
    const script = getSsrBetaRedirectScript();

    expect(script).toContain(SSR_BETA_REDIRECT_MARKER);
    expect(script).toContain(BETA_REDIRECT_STORAGE_KEY);
    expect(script).not.toContain("document.cookie");
  });
});
