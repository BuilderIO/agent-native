import { type H3Event, mockEvent } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verifyEmbedSessionToken: vi.fn() }));

vi.mock("@agent-native/core/server", () => ({
  verifyEmbedSessionToken: mocks.verifyEmbedSessionToken,
}));

import registerBuilderHostEmbedHeaders from "./builder-host-embed-headers.js";

type ResponseHook = (res: Response, event: H3Event) => void;

/**
 * Captures the hook by the name Nitro actually calls. Nitro 3 has no
 * `beforeResponse`, and an unknown name registers a listener that never fires.
 */
function responseHook(): ResponseHook {
  const registered = new Map<string, ResponseHook>();
  registerBuilderHostEmbedHeaders({
    hooks: {
      hook: (name: string, fn: ResponseHook) => registered.set(name, fn),
    },
  });
  expect([...registered.keys()]).toEqual(["response"]);
  return registered.get("response")!;
}

function requestWith({
  queryToken,
  cookieToken,
}: {
  queryToken?: string;
  cookieToken?: string;
}): H3Event {
  return mockEvent(
    `/visual-edit/design-1${queryToken ? `?__an_embed_token=${queryToken}` : ""}`,
    {
      headers: cookieToken ? { cookie: `an_embed_session=${cookieToken}` } : {},
    },
  );
}

const responseWith = (coep?: string) =>
  new Response("", {
    headers: coep ? { "cross-origin-embedder-policy": coep } : {},
  });

function verifiesAs(scope: string | undefined) {
  mocks.verifyEmbedSessionToken.mockReturnValue({
    ok: true,
    claims: { scope },
  });
}

const coepOf = (res: Response) =>
  res.headers.get("cross-origin-embedder-policy");

describe("builder-host embed headers", () => {
  beforeEach(() => {
    mocks.verifyEmbedSessionToken.mockReset();
  });

  it("drops COEP for a Builder-host embed so the canvas can frame containers", () => {
    verifiesAs("builder-host:design:design-1");
    const res = responseWith("require-corp");
    responseHook()(res, requestWith({ queryToken: "tok" }));
    expect(coepOf(res)).toBe("unsafe-none");
  });

  it("drops COEP when the token arrives by cookie, as it does on reload", () => {
    verifiesAs("builder-host:design:design-1");
    const res = responseWith("require-corp");
    responseHook()(res, requestWith({ cookieToken: "tok" }));
    expect(coepOf(res)).toBe("unsafe-none");
  });

  it("keeps COEP for other embed scopes, which COEP hosts require", () => {
    verifiesAs("capability:read-design");
    const res = responseWith("require-corp");
    responseHook()(res, requestWith({ queryToken: "tok" }));
    expect(coepOf(res)).toBe("require-corp");
  });

  it("keeps COEP for a scopeless embed session", () => {
    verifiesAs(undefined);
    const res = responseWith("require-corp");
    responseHook()(res, requestWith({ queryToken: "tok" }));
    expect(coepOf(res)).toBe("require-corp");
  });

  it("keeps COEP when the token does not verify", () => {
    mocks.verifyEmbedSessionToken.mockReturnValue({ ok: false });
    const res = responseWith("require-corp");
    responseHook()(res, requestWith({ queryToken: "forged" }));
    expect(coepOf(res)).toBe("require-corp");
  });

  it("never verifies a token on responses that carry no COEP", () => {
    const res = responseWith();
    responseHook()(res, requestWith({ queryToken: "tok" }));
    expect(mocks.verifyEmbedSessionToken).not.toHaveBeenCalled();
    expect(coepOf(res)).toBeNull();
  });
});
