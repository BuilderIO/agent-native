import { beforeEach, describe, expect, it, vi } from "vitest";

const resultQueue = vi.hoisted(() => ({ current: [] as unknown[][] }));
const limit = vi.hoisted(() =>
  vi.fn(async () => resultQueue.current.shift() ?? []),
);
const where = vi.hoisted(() => vi.fn(() => ({ limit })));
const from = vi.hoisted(() => vi.fn(() => ({ where })));
const select = vi.hoisted(() => vi.fn(() => ({ from })));
const configuredBasePath = vi.hoisted(() => ({ current: "" }));
const mockVerifyScopedAgentAccessToken = vi.hoisted(() =>
  vi.fn((_token: unknown, _options: unknown) => ({ ok: false })),
);

vi.mock("@/pages/SharedPresentation", () => ({ default: () => null }));
vi.mock("@/components/ui/spinner", () => ({ Spinner: () => null }));

// The presentation page renders impersonally on the server (SSR reads no
// session so the public page stays CDN-cacheable), so the loader no longer
// reads the request user — it only needs the app base path to build the
// client-side redirect to the auth-guarded editor for restricted decks.
vi.mock("@agent-native/core/server", () => ({
  AGENT_ACCESS_PARAM: "agent_access",
  getConfiguredAppBasePath: () => configuredBasePath.current,
  verifyScopedAgentAccessToken: (token: unknown, options: unknown) =>
    mockVerifyScopedAgentAccessToken(token, options),
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
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

import { buildDeckDiscovery, loader } from "../routes/p.$id";

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
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: false });
  });

  it("serves a public deck for every viewer without speaker notes", async () => {
    resultQueue.current = [deckRows("public")];

    const result = unwrapLoaderData(await loader(requestFor()));

    if (result.deck === null) throw new Error("expected a public deck");
    expect(result.deck?.title).toBe("Launch review");
    expect(result.basePath).toBe("");
    expect(result.deck?.aspectRatio).toBe("16:9");
    expect(result.deck?.slides).toEqual([
      {
        id: "slide-1",
        content: "<h1>Launch</h1>",
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
    // SSR is impersonal: the deck is looked up by id alone, and visibility is
    // checked in JS — no per-user access filter is applied server-side.
    expect(where).toHaveBeenCalledWith({ column: "id_col", value: "deck-1" });
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
    resultQueue.current = [deckRows("public")];

    const result = unwrapLoaderData(await loader(requestFor()));

    expect(result).toMatchObject({
      id: "deck-1",
      basePath: "/slides",
    });
  });

  it("routes a restricted (non-public) deck to the guarded editor for client-side access resolution", async () => {
    resultQueue.current = [deckRows("private")];

    const result = unwrapLoaderData(await loader(requestFor()));

    if (result.deck !== null) throw new Error("expected a restricted deck");
    expect(result.error).toBe("restricted");
    expect(result.restricted).toEqual({ id: "deck-1", basePath: "" });
  });

  it("marks tokenized deck pages private and no-store", async () => {
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: true });
    resultQueue.current = [deckRows("private")];

    const result = (await loader(requestFor("deck-1", "tok+1"))) as any;

    expect(mockVerifyScopedAgentAccessToken).toHaveBeenCalledWith("tok+1", {
      resourceKind: "slides:deck",
      resourceId: "deck-1",
    });
    expect(result.type).toBe("DataWithResponseInit");
    expect(result.init.headers).toEqual({
      "Cache-Control": "private, max-age=0, no-store",
      "Referrer-Policy": "no-referrer",
    });
    expect(result.data.agentAccessToken).toBe("tok+1");
    if (result.data.deck === null) throw new Error("expected tokenized deck");
    expect(result.data.deck.title).toBe("Launch review");
  });

  it("404s when the deck does not exist", async () => {
    resultQueue.current = [[]];
    await expect(loader(requestFor())).rejects.toMatchObject({ status: 404 });
  });
});

function deckRows(visibility: "public" | "private" | "org") {
  return [
    {
      title: "Launch review",
      visibility,
      data: JSON.stringify({
        aspectRatio: "16:9",
        slides: [
          {
            id: "slide-1",
            content: "<h1>Launch</h1>",
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
