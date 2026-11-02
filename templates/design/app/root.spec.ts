// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getEmbedAuthToken } from "@agent-native/core/client/host";
import { EMBED_TOKEN_QUERY_PARAM } from "@agent-native/core/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/host")>()),
  getEmbedAuthToken: vi.fn(() => null),
}));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  Meta: () => null,
  Links: () => null,
  Scripts: () => null,
  ScrollRestoration: () => null,
}));

import { renderToStaticMarkup } from "react-dom/server";

import { Layout, computeSessionBypass } from "./root";

describe("computeSessionBypass", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.mocked(getEmbedAuthToken).mockReturnValue(null);
  });

  it("does not bypass for the bare embedded=1 flag with no token", () => {
    window.history.replaceState(null, "", "/home?embedded=1&chatFirst=1");
    expect(computeSessionBypass("/home")).toBe(false);
  });

  it("bypasses when a real embed token is present", () => {
    vi.mocked(getEmbedAuthToken).mockReturnValue("signed-token");
    window.history.replaceState(
      null,
      "",
      `/design/design-123?embedded=1&${EMBED_TOKEN_QUERY_PARAM}=signed-token`,
    );
    expect(computeSessionBypass("/design/design-123")).toBe(true);
  });

  it("still bypasses public design app routes with no embed credential", () => {
    expect(computeSessionBypass("/visual-edit/abc123")).toBe(true);
  });
});

describe("command menu shortcut", () => {
  it("opens from the home prompt composer, which holds focus on load", () => {
    // The shared hook drops the shortcut while a contenteditable has focus
    // unless the app opts in; the focused home composer made it a dead key.
    const source = readFileSync(join(import.meta.dirname, "root.tsx"), "utf8");
    expect(source).toMatch(
      /useCommandMenuShortcut\([\s\S]*?\{ allowContentEditable: true \},?\s*\);/,
    );
  });
});

describe("Layout", () => {
  it("opts out of browser auto-translate so React keeps owning its text nodes", () => {
    const html = renderToStaticMarkup(Layout({ children: null }));
    expect(html).toMatch(/<html[^>]*translate="no"/);
    expect(html).toContain('<meta name="google" content="notranslate"/>');
  });
});
