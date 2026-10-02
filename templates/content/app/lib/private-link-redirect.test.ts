import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HIDDEN_WHILE_PRIVATE_LINK_REDIRECTS,
  PRIVATE_LINK_REDIRECT_ATTRIBUTE,
  privateDocumentRedirectScript,
  privateLinkRedirectStarted,
} from "./private-link-redirect";

function runScript(script: string) {
  const setAttribute = vi.fn();
  const replace = vi.fn();
  new Function("document", "location", script)(
    { documentElement: { setAttribute } },
    { replace },
  );
  return { setAttribute, replace };
}

describe("privateDocumentRedirectScript", () => {
  it("hides the notice and leaves for the app page", () => {
    const { setAttribute, replace } = runScript(
      privateDocumentRedirectScript("/content/page/FsXU0lX7Ime9"),
    );

    expect(setAttribute).toHaveBeenCalledWith(
      PRIVATE_LINK_REDIRECT_ATTRIBUTE,
      "",
    );
    expect(replace).toHaveBeenCalledWith("/content/page/FsXU0lX7Ime9");
  });

  it("cannot be closed early by the page address", () => {
    const href = '/page/</script><script>alert("x")</script>';
    const script = privateDocumentRedirectScript(href);

    expect(script).not.toContain("</script>");
    expect(runScript(script).replace).toHaveBeenCalledWith(href);
  });

  it("hides the notice on the attribute the script sets", () => {
    expect(HIDDEN_WHILE_PRIVATE_LINK_REDIRECTS).toBe(
      `[html[${PRIVATE_LINK_REDIRECT_ATTRIBUTE}]_&]:invisible`,
    );
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
