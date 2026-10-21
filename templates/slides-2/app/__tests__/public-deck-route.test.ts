// @vitest-environment happy-dom

import { render, screen, waitFor } from "@testing-library/react";
import { createElement, StrictMode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resultQueue = vi.hoisted(() => ({ current: [] as unknown[][] }));
const limit = vi.hoisted(() =>
  vi.fn(async () => resultQueue.current.shift() ?? []),
);
const where = vi.hoisted(() => vi.fn(() => ({ limit })));
const from = vi.hoisted(() => vi.fn(() => ({ where })));
const select = vi.hoisted(() => vi.fn(() => ({ from })));
const configuredBasePath = vi.hoisted(() => ({ current: "" }));
vi.mock("@/pages/SharedPresentation", () => ({
  default: ({
    agentAccessDeckId,
    agentAccessToken,
  }: {
    agentAccessDeckId?: string;
    agentAccessToken?: string | null;
  }) =>
    createElement(
      "output",
      {
        "data-testid": "private-deck-access",
        "data-deck-id": agentAccessDeckId,
      },
      agentAccessToken ?? "no-token",
    ),
}));
vi.mock("@/components/ui/spinner", () => ({ Spinner: () => null }));

vi.mock("@agent-native/core/server", () => ({
  getConfiguredAppBasePath: () => configuredBasePath.current,
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
}));

vi.mock("../../server/db", () => ({
  getDb: () => ({ select }),
  schema: {
    decks: {
      id: "id_col",
      title: "title_col",
      data: "data_col",
      visibility: "visibility_col",
    },
    deckShares: "deck_shares_table",
  },
}));

import {
  buildDeckDiscovery,
  headers as routeHeaders,
  loader,
} from "../routes/p.$id";
import PublicDeckRoute from "../routes/p.$id";

function unwrapLoaderData(result: Awaited<ReturnType<typeof loader>>) {
  const maybeWrapped = result as any;
  return maybeWrapped.type === "DataWithResponseInit"
    ? maybeWrapped.data
    : maybeWrapped;
}

function requestFor(id = "deck-1", token?: string) {
  const url = new URL(`https://slides.example.test/p/${id}`);
  if (token) url.searchParams.set("agent_access", token);
  return {
    params: { id },
    request: new Request(url),
  } as any;
}

describe("public deck route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configuredBasePath.current = "";
    resultQueue.current = [];
  });

  it("serves a public deck for every viewer without speaker notes", async () => {
    resultQueue.current = [deckVisibilityRows("public"), publicDeckRows()];

    const result = unwrapLoaderData(await loader(requestFor()));

    if (result.deck === null) throw new Error("expected a public deck");
    expect(result.deck?.title).toBe("Launch review");
    expect(result.basePath).toBe("");
    expect(result.deck?.aspectRatio).toBe("16:9");
    expect(result.deck?.slides).toEqual([
      {
        id: "slide-1",
        content:
          '<div class="fmd-slide"><p>Intro</p><div><h1>Launch</h1></div></div>',
        notes: "",
        layout: "title",
        background: "#111",
        transition: "fade",
        splitByParagraph: true,
        animations: [
          {
            id: "anim-1",
            elementIndex: 0,
            elementPath: [1, 0],
            type: "slide-up",
          },
        ],
      },
    ]);
    expect(where).toHaveBeenCalledWith({ column: "id_col", value: "deck-1" });
    expect(select).toHaveBeenNthCalledWith(1, {
      id: "id_col",
      visibility: "visibility_col",
    });
    expect(select).toHaveBeenNthCalledWith(2, {
      title: "title_col",
      data: "data_col",
    });
    expect(where).toHaveBeenNthCalledWith(2, {
      and: [
        { column: "id_col", value: "deck-1" },
        { column: "visibility_col", value: "public" },
      ],
    });
  });

  it("prefixes agent-readable deck context URLs with the app base path", () => {
    const discovery = buildDeckDiscovery({
      id: "deck-1",
      title: "Launch review",
      basePath: "/slides",
    });

    expect(discovery.url).toBe("/slides/p/deck-1");
    expect(discovery.contextUrl).toBe(
      "/slides/api/deck-agent-context.json?id=deck-1",
    );
  });

  it("returns the configured app base path for public deck discovery", async () => {
    configuredBasePath.current = "/slides";
    resultQueue.current = [deckVisibilityRows("public"), publicDeckRows()];

    const result = unwrapLoaderData(await loader(requestFor()));

    expect(result).toMatchObject({
      id: "deck-1",
      basePath: "/slides",
    });
  });

  it.each(["private", "org"] as const)(
    "routes a %s deck to the guarded editor for client-side access resolution",
    async (visibility) => {
      resultQueue.current = [deckVisibilityRows(visibility)];

      const result = unwrapLoaderData(await loader(requestFor()));

      if (result.deck !== null) throw new Error("expected a restricted deck");
      expect(result.error).toBe("restricted");
      expect(result.restricted).toEqual({ id: "deck-1", basePath: "" });
      expect(select).toHaveBeenCalledTimes(1);
      expect(select).toHaveBeenCalledWith({
        id: "id_col",
        visibility: "visibility_col",
      });
    },
  );

  it("keeps token-authorized private deck content out of server loader data", async () => {
    resultQueue.current = [deckVisibilityRows("private")];

    const result = unwrapLoaderData(
      await loader(requestFor("deck-1", "tok+1")),
    );

    expect(result).toEqual({
      deck: null,
      error: "restricted",
      restricted: { id: "deck-1", basePath: "" },
    });
    expect(JSON.stringify(result)).not.toContain("internal talking points");
    expect(JSON.stringify(result)).not.toContain("tok+1");
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith({
      id: "id_col",
      visibility: "visibility_col",
    });
  });

  it("scrubs the private access token before forwarding it to the client deck view", async () => {
    const token = "scoped+private-token";
    const url = new URL(`${window.location.origin}/p/deck-1`);
    url.searchParams.set("agent_access", token);
    url.searchParams.set("slide", "2");
    url.hash = "present";
    window.history.replaceState(window.history.state, "", url.href);

    const router = createMemoryRouter(
      [
        {
          path: "/p/:id",
          loader: () => ({
            deck: null,
            error: "restricted",
            restricted: { id: "deck-1", basePath: "" },
          }),
          Component: PublicDeckRoute,
        },
      ],
      { initialEntries: [url.pathname + url.search + url.hash] },
    );

    render(
      createElement(
        StrictMode,
        null,
        createElement(RouterProvider, { router }),
      ),
    );

    await waitFor(() => expect(window.location.search).toBe("?slide=2"));
    expect(window.location.hash).toBe("#present");
    expect(screen.getByTestId("private-deck-access").textContent).toBe(token);
    expect(screen.getByTestId("private-deck-access").dataset.deckId).toBe(
      "deck-1",
    );
  });

  it("sets a path-invariant no-referrer policy while preserving cache headers", () => {
    const responseHeaders = routeHeaders({
      loaderHeaders: new Headers({ "Cache-Control": "public, max-age=60" }),
    } as never);

    expect(responseHeaders.get("Referrer-Policy")).toBe("no-referrer");
    expect(responseHeaders.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("404s when the deck does not exist", async () => {
    resultQueue.current = [[]];
    await expect(loader(requestFor())).rejects.toMatchObject({ status: 404 });
  });
});

function deckVisibilityRows(visibility: "public" | "private" | "org") {
  return [{ id: "deck-1", visibility }];
}

function publicDeckRows() {
  return [
    {
      title: "Launch review",
      data: JSON.stringify({
        aspectRatio: "16:9",
        slides: [
          {
            id: "slide-1",
            content:
              '<div class="fmd-slide"><p>Intro</p><div><h1>Launch</h1></div></div>',
            notes: "internal talking points",
            layout: "title",
            background: "#111",
            transition: "fade",
            splitByParagraph: true,
            animations: [
              {
                id: "anim-1",
                elementIndex: 0,
                elementPath: [1, 0],
                type: "slide-up",
              },
            ],
          },
        ],
      }),
    },
  ];
}
