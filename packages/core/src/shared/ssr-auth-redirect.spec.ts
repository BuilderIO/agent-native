import { describe, expect, it } from "vitest";

import { getSsrAuthRedirectScript } from "./ssr-auth-redirect.js";

function scriptBody(sessionHintCookieName?: string): string {
  const script = getSsrAuthRedirectScript(sessionHintCookieName);
  return script.slice(script.indexOf(">") + 1, script.lastIndexOf("</script>"));
}

function runScript({
  session,
  cookie = "",
  sessionHintCookieName,
  pathname = "/",
  search = "",
  hash = "",
  responseOk = true,
  homeStatus = 200,
  homeFollowedStatus,
}: {
  session: Record<string, unknown> | null;
  cookie?: string;
  sessionHintCookieName?: string;
  pathname?: string;
  search?: string;
  hash?: string;
  responseOk?: boolean;
  homeStatus?: number;
  homeFollowedStatus?: number;
}) {
  const result = { redirectedTo: null as string | null };
  let fetchCount = 0;
  const window = {
    location: {
      pathname,
      search,
      hash,
      replace(value: string) {
        result.redirectedTo = value;
      },
    },
  } as unknown as {
    __agentNativeAuthRedirectStarted?: boolean;
    location: {
      pathname: string;
      search: string;
      hash: string;
      replace(value: string): void;
    };
  };
  const document = { cookie };
  const fetch = async (_input: unknown) => {
    fetchCount += 1;
    if (fetchCount > 1) {
      const status = homeFollowedStatus ?? homeStatus;
      return { ok: status >= 200 && status < 400, status } as Response;
    }
    return {
      ok: responseOk,
      json: async () => session,
    } as Response;
  };

  new Function(
    "window",
    "document",
    "fetch",
    scriptBody(sessionHintCookieName),
  )(window, document, fetch);

  return Object.assign(result, { window, fetchCount });
}

describe("getSsrAuthRedirectScript", () => {
  it("redirects synchronously from the head when the session hint is present", () => {
    const result = runScript({
      session: null,
      cookie: "analytics=1; an_session_slides_hint=1",
      sessionHintCookieName: "an_session_slides_hint",
      pathname: "/docs/",
      search: "?from=hero",
      hash: "#start",
    });

    expect(result.redirectedTo).toBe("/docs/home?from=hero#start");
    expect(result.fetchCount).toBe(0);
  });

  it("requires an exact readable hint cookie", () => {
    const result = runScript({
      session: null,
      cookie: "an_session_slides_hint_extra=1; an_session_slides_hint=0",
      sessionHintCookieName: "an_session_slides_hint",
    });

    expect(result.redirectedTo).toBeNull();
    expect(result.fetchCount).toBe(1);
  });

  it("redirects an authenticated visitor to the mounted app home", async () => {
    const result = runScript({
      session: { email: "person@example.test" },
      pathname: "/docs/",
      search: "?from=hero",
      hash: "#start",
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 25));

    expect(result.redirectedTo).toBe("/docs/home?from=hero#start");
  });

  it("keeps signed-out and unreadable sessions on the marketing page", async () => {
    const signedOut = runScript({ session: { error: "Not authenticated" } });
    const unreadable = runScript({ session: null, responseOk: false });

    await new Promise<void>((resolve) => setTimeout(resolve, 25));

    expect(signedOut.redirectedTo).toBeNull();
    expect(unreadable.redirectedTo).toBeNull();
  });

  it("does not send an authenticated visitor to a missing app home", async () => {
    const result = runScript({
      session: { email: "person@example.test" },
      homeStatus: 404,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 25));

    expect(result.redirectedTo).toBeNull();
  });

  it("redirects when the app home resolves through a route redirect", async () => {
    const result = runScript({
      session: { email: "person@example.test" },
      homeStatus: 302,
      homeFollowedStatus: 200,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 25));

    expect(result.redirectedTo).toBe("/home");
  });

  it("emits an inline head-safe script marker", () => {
    const script = getSsrAuthRedirectScript();

    expect(script).toContain("data-agent-native-auth-redirect");
    expect(script).toContain('cache: "no-store"');
    expect(script).toContain("/_agent-native/auth/session");
    expect(script).toContain('method: "HEAD"');
    expect(script).toContain("document.cookie");
    expect(script).not.toContain('redirect: "manual"');
  });
});
