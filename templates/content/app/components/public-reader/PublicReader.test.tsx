import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import type { PublicReaderContext } from "@shared/public-reader";

import { PublicReader, publicReaderSignInHrefs } from "./PublicReader";

const DOCUMENT = {
  id: "doc-1",
  title: "Repair log",
  updatedAt: "2026-10-22T12:00:00.000Z",
};

function render(
  options: {
    reader?: Partial<PublicReaderContext>;
    basePath?: string;
    signedIn?: boolean;
  } = {},
) {
  return renderToStaticMarkup(
    createElement(PublicReader, {
      document: DOCUMENT,
      reader: {
        icon: null,
        ancestors: [],
        subPages: [],
        pageLinks: {},
        ...options.reader,
      },
      basePath: options.basePath ?? "",
      signedIn: options.signedIn ?? false,
      children: createElement("p", null, "Page body"),
    }),
  );
}

function hrefs(html: string) {
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) =>
    match[1].replace(/&amp;/g, "&"),
  );
}

describe("public reader", () => {
  it("offers a signed-out reader sign-in and sign-up that come back to the page", () => {
    const html = render();
    const { signIn, signUp } = publicReaderSignInHrefs("doc-1", "");

    expect(signIn).toMatch(/^\/sign-in\?c=[\w-]+$/);
    expect(signUp).toBe(`${signIn}&tab=signup`);
    // The top bar and the card at the end each carry both.
    expect(hrefs(html).filter((href) => href === signIn)).toHaveLength(2);
    expect(hrefs(html).filter((href) => href === signUp)).toHaveLength(2);
    expect(html).toContain("publicDocument.tryContentFree");
    expect(html).toContain("publicDocument.writtenIn");
    expect(html).not.toContain("publicDocument.chat");
  });

  it("gives a signed-in reader Chat instead of sign-in and the invitation", () => {
    const html = render({ signedIn: true });

    expect(html).toContain("publicDocument.chat");
    expect(html).not.toContain("sign-in");
    expect(html).not.toContain("publicDocument.writtenIn");
  });

  it("keeps sign-in inside the app's base path", () => {
    const { signIn, signUp } = publicReaderSignInHrefs("doc 1", "/content");

    expect(signIn).toMatch(/^\/content\/sign-in\?c=[\w-]+$/);
    expect(signUp).toBe(`${signIn}&tab=signup`);
    const token = new URL(signIn, "https://x.test").searchParams.get("c") ?? "";
    expect(
      decodeURIComponent(atob(token.replace(/-/g, "+").replace(/_/g, "/"))),
    ).toBe("/content/page/doc%201");
  });

  it("links the path and the sub-pages to their public pages", () => {
    const html = render({
      basePath: "/content",
      reader: {
        ancestors: [{ id: "parent-1", title: "Tool shed", icon: null }],
        subPages: [
          {
            id: "child-1",
            title: "Hose nozzles",
            icon: { version: 1, kind: "emoji", emoji: "🔧" },
          },
          { id: "child-2", title: " ", icon: null },
        ],
      },
    });

    expect(hrefs(html)).toEqual(
      expect.arrayContaining([
        "/content/p/parent-1",
        "/content/p/child-1",
        "/content/p/child-2",
      ]),
    );
    expect(html).toContain("Tool shed");
    expect(html).toContain("Hose nozzles");
    expect(html).toContain("sidebar.untitled");
    expect(html).toContain('aria-label="publicDocument.subPages"');
    expect(html).toContain('aria-current="page"');
  });

  it("folds the middle of a deep path, keeping the root and the parent", () => {
    const html = render({
      reader: {
        ancestors: ["Root", "Middle", "Lower", "Parent"].map(
          (title, index) => ({
            id: `a-${index}`,
            title,
            icon: null,
          }),
        ),
      },
    });

    expect(html).toContain("Root");
    expect(html).toContain("Parent");
    expect(html).not.toContain("Middle");
    expect(html).not.toContain("Lower");
    expect(html).toContain("…");
  });

  it("leaves the sub-page list out when there are none", () => {
    expect(render()).not.toContain("publicDocument.subPages");
  });
});
