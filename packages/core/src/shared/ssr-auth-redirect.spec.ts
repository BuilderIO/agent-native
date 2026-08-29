import { describe, expect, it } from "vitest";

import { getSsrAuthRedirectScript } from "./ssr-auth-redirect.js";

function scriptBody(): string {
  const script = getSsrAuthRedirectScript();
  return script.slice(script.indexOf(">") + 1, script.lastIndexOf("</script>"));
}

function runScript({
  session,
  pathname = "/",
  search = "",
  hash = "",
  responseOk = true,
  homeStatus = 200,
}: {
  session: Record<string, unknown> | null;
  pathname?: string;
  search?: string;
  hash?: string;
  responseOk?: boolean;
  homeStatus?: number;
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
  const fetch = async () => {
    fetchCount += 1;
    if (fetchCount > 1) return { status: homeStatus } as Response;
    return {
      ok: responseOk,
      json: async () => session,
    } as Response;
  };

  new Function("window", "fetch", scriptBody())(window, fetch);

  return Object.assign(result, { window });
}

describe("getSsrAuthRedirectScript", () => {
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

  it("emits an inline head-safe script marker", () => {
    const script = getSsrAuthRedirectScript();

    expect(script).toContain("data-agent-native-auth-redirect");
    expect(script).toContain('cache: "no-store"');
    expect(script).toContain("/_agent-native/auth/session");
    expect(script).toContain('method: "HEAD"');
  });
});
