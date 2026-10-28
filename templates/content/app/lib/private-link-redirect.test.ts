import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HIDDEN_WHILE_PRIVATE_LINK_REDIRECTS,
  PRIVATE_LINK_REDIRECT_ATTRIBUTE,
  privateDocumentRedirectHref,
  privateDocumentRedirectScript,
  privateLinkRedirectStarted,
} from "./private-link-redirect";

const PAGE_HREF = "/content/page/FsXU0lX7Ime9";
const SIGN_IN_HREF = "/content/sign-in?c=L2NvbnRlbnQvcGFnZS9Gc1hVMGxYN0ltZTk";

function runScript(script: string, cookie = "") {
  const setAttribute = vi.fn();
  const replace = vi.fn();
  new Function("document", "location", script)(
    { cookie, documentElement: { setAttribute } },
    { replace },
  );
  return { setAttribute, replace };
}

describe("privateDocumentRedirectScript", () => {
  it("hides the notice and leaves for the app page with a session hint", () => {
    const { setAttribute, replace } = runScript(
      privateDocumentRedirectScript(PAGE_HREF, SIGN_IN_HREF),
      "theme=dark; an_session_hint=1",
    );

    expect(setAttribute).toHaveBeenCalledWith(
      PRIVATE_LINK_REDIRECT_ATTRIBUTE,
      "",
    );
    expect(replace).toHaveBeenCalledWith(PAGE_HREF);
  });

  it("reads an app's own session hint cookie", () => {
    const { replace } = runScript(
      privateDocumentRedirectScript(PAGE_HREF, SIGN_IN_HREF),
      "an_session_content_hint=1",
    );

    expect(replace).toHaveBeenCalledWith(PAGE_HREF);
  });

  // A signed-out app page sends its visitor to this page, so going there
  // without a session would bounce between the two.
  it.each([
    ["no cookies", ""],
    ["other cookies", "theme=dark; an_session_hintx=1"],
    ["a cleared hint", "an_session_hint=0"],
  ])("goes straight to sign-in with %s", (_label, cookie) => {
    const { setAttribute, replace } = runScript(
      privateDocumentRedirectScript(PAGE_HREF, SIGN_IN_HREF),
      cookie,
    );

    expect(setAttribute).toHaveBeenCalledWith(
      PRIVATE_LINK_REDIRECT_ATTRIBUTE,
      "",
    );
    expect(replace).toHaveBeenCalledWith(SIGN_IN_HREF);
  });

  it("cannot be closed early by the page address", () => {
    const href = '/page/</script><script>alert("x")</script>';
    const script = privateDocumentRedirectScript(href, href);

    expect(script).not.toContain("</script>");
    expect(runScript(script).replace).toHaveBeenCalledWith(href);
  });

  it("hides the notice on the attribute the script sets", () => {
    expect(HIDDEN_WHILE_PRIVATE_LINK_REDIRECTS).toBe(
      `[html[${PRIVATE_LINK_REDIRECT_ATTRIBUTE}]_&]:invisible`,
    );
  });
});

describe("privateDocumentRedirectHref", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("picks the same place as the script", () => {
    for (const cookie of [
      "",
      "an_session_hint=1",
      "an_session_content_hint=1",
      "an_session_hint=0",
    ]) {
      vi.stubGlobal("document", { cookie });
      expect(privateDocumentRedirectHref(PAGE_HREF, SIGN_IN_HREF)).toBe(
        runScript(
          privateDocumentRedirectScript(PAGE_HREF, SIGN_IN_HREF),
          cookie,
        ).replace.mock.calls[0]?.[0],
      );
    }
  });
});

describe("privateLinkRedirectStarted", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the move the script already started", () => {
    const attributes = new Set<string>();
    vi.stubGlobal("document", {
      documentElement: {
        hasAttribute: (name: string) => attributes.has(name),
      },
    });

    expect(privateLinkRedirectStarted()).toBe(false);
    attributes.add(PRIVATE_LINK_REDIRECT_ATTRIBUTE);
    expect(privateLinkRedirectStarted()).toBe(true);
  });
});
