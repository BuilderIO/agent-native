import { type H3Event, mockEvent } from "h3";
import { describe, expect, it } from "vitest";

import registerBuilderHostEmbedHeaders, {
  isShellCanvasRequest,
} from "./builder-host-embed-headers";

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

const responseWith = (coep?: string) =>
  new Response("", {
    headers: coep ? { "cross-origin-embedder-policy": coep } : {},
  });

const coepOf = (res: Response) =>
  res.headers.get("cross-origin-embedder-policy");
const cspOf = (res: Response) => res.headers.get("content-security-policy");

describe("isShellCanvasRequest", () => {
  it("matches only the shell canvas route", () => {
    expect(isShellCanvasRequest(mockEvent("/visual-edit/shell"))).toBe(true);
    expect(
      isShellCanvasRequest(mockEvent("/visual-edit/shell?embedded=1")),
    ).toBe(true);
  });

  it("does not match an ordinary design or visual-edit page", () => {
    expect(isShellCanvasRequest(mockEvent("/visual-edit/abc123"))).toBe(false);
    expect(isShellCanvasRequest(mockEvent("/design/abc123"))).toBe(false);
    expect(isShellCanvasRequest(mockEvent("/"))).toBe(false);
    // A design literally named "shell" still lives under a longer path.
    expect(isShellCanvasRequest(mockEvent("/visual-edit/shell/extra"))).toBe(
      false,
    );
  });
});

describe("shell canvas headers", () => {
  it("drops COEP so the canvas can frame containers", () => {
    const res = responseWith("require-corp");
    responseHook()(res, mockEvent("/visual-edit/shell"));
    expect(coepOf(res)).toBe("unsafe-none");
  });

  it("restricts embedding to Builder, since there is no token to check", () => {
    const res = responseWith("require-corp");
    responseHook()(res, mockEvent("/visual-edit/shell"));
    const csp = cspOf(res)!;
    expect(csp).toContain("frame-ancestors");
    expect(csp).toContain("https://builder.io");
    expect(csp).toContain("https://*.builder.io");
  });

  it("leaves every other route's headers alone", () => {
    for (const path of ["/visual-edit/abc123", "/design/abc123", "/"]) {
      const res = responseWith("require-corp");
      responseHook()(res, mockEvent(path));
      expect(coepOf(res)).toBe("require-corp");
      expect(cspOf(res)).toBeNull();
    }
  });

  it("sets the headers even when core emitted no COEP for this response", () => {
    const res = responseWith();
    responseHook()(res, mockEvent("/visual-edit/shell"));
    expect(coepOf(res)).toBe("unsafe-none");
    expect(cspOf(res)).toContain("frame-ancestors");
  });
});
