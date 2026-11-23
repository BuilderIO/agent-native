import { describe, expect, it } from "vitest";

import {
  appEmbedHref,
  appEmbedIframeSnippet,
  cellEmbedHref,
  cellLinkHref,
  parseCellLinkHash,
  parseEmbeddedApp,
  parseEmbeddedCell,
  parseEmbedToken,
} from "./cell-link";

describe("parseCellLinkHash", () => {
  it("reads the cell a fragment names, decoding escapes", () => {
    expect(parseCellLinkHash("#cell-cel_abc")).toBe("cel_abc");
    expect(parseCellLinkHash("#cell-a%20b")).toBe("a b");
  });
  it.each(["", "#", "#cell-", "#other-cel_a", "#cell-%", "#cell-%E0%A4%A"])(
    "names no cell for %j",
    (hash) => {
      expect(parseCellLinkHash(hash)).toBeNull();
    },
  );
});

describe("cellLinkHref", () => {
  const at = (pathname: string) => ({ origin: "https://x.test", pathname });
  it("links the notebook view under the app's own base path", () => {
    expect(
      cellLinkHref(at("/analytics-2/project/p1/latest/agent"), {
        projectId: "p1",
        cellId: "c1",
        target: "notebook",
      }),
    ).toBe("https://x.test/analytics-2/project/p1/latest/logic#cell-c1");
  });
  it("links the latest published app, never the Agent or editor route", () => {
    expect(
      cellLinkHref(at("/analytics-2/project/p1/latest/app"), {
        projectId: "p1",
        cellId: "c1",
        target: "app",
      }),
    ).toBe("https://x.test/analytics-2/app/p1/latest#cell-c1");
  });
  it("works with no base path and escapes ids", () => {
    expect(
      cellLinkHref(at("/project/p 1/latest/logic"), {
        projectId: "p 1",
        cellId: "c/1",
        target: "notebook",
      }),
    ).toBe("https://x.test/project/p%201/latest/logic#cell-c%2F1");
  });
  it("round-trips through the parser", () => {
    const href = new URL(
      cellLinkHref(at("/project/p/latest/logic"), {
        projectId: "p",
        cellId: "c 1/%",
        target: "app",
      }),
    );
    expect(parseCellLinkHash(href.hash)).toBe("c 1/%");
  });
});

describe("embedding one cell", () => {
  it("builds a published app address under the base path that round-trips", () => {
    const href = new URL(
      cellEmbedHref(
        {
          origin: "https://x.test",
          pathname: "/analytics-2/project/p1/latest/logic",
        },
        { projectId: "p1", cellId: "c 1&2" },
      ),
    );
    expect(href.pathname).toBe("/analytics-2/app/p1/latest");
    expect(parseEmbeddedCell(href.search)).toBe("c 1&2");
  });
  it.each(["", "?", "?embed=", "?other=1"])(
    "asks for no cell with %j",
    (search) => {
      expect(parseEmbeddedCell(search)).toBeNull();
    },
  );
});

describe("embedding a full published app", () => {
  it("builds a full-app embedded URL and iframe snippet with and without signed token", () => {
    const plainUrl = appEmbedHref(
      {
        origin: "https://x.test",
        pathname: "/analytics-2/project/p1/latest/logic",
      },
      { projectId: "p1" },
    );
    expect(plainUrl).toBe(
      "https://x.test/analytics-2/app/p1/latest?embedded=true",
    );
    expect(parseEmbeddedApp(new URL(plainUrl).search)).toBe(true);
    expect(parseEmbedToken(new URL(plainUrl).search)).toBeNull();
    expect(appEmbedIframeSnippet(plainUrl)).toBe(
      `<iframe width="100%" height="600" style="border:0" src="${plainUrl}"></iframe>`,
    );

    const signedUrl = appEmbedHref(
      {
        origin: "https://x.test",
        pathname: "/analytics-2/app/p1/latest",
      },
      {
        projectId: "p1",
        appHref: "/analytics-2/app/p1/latest",
        embedToken: "emb_abc_123",
      },
    );
    expect(signedUrl).toBe(
      "https://x.test/analytics-2/app/p1/latest?embedded=true&embedToken=emb_abc_123",
    );
    expect(parseEmbeddedApp(new URL(signedUrl).search)).toBe(true);
    expect(parseEmbedToken(new URL(signedUrl).search)).toBe("emb_abc_123");
  });

  it.each(["", "?", "?embedded=false", "?other=1"])(
    "treats %j as non-embedded",
    (search) => {
      expect(parseEmbeddedApp(search)).toBe(false);
    },
  );
});
