import { beforeEach, describe, expect, it, vi } from "vitest";

type Clause =
  | { kind: "and" | "or"; conditions: Clause[] }
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "inArray"; column: string; values: unknown[] }
  | { kind: "like"; column: string; value: string }
  | { kind: "isNull"; column: string };

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  select: vi.fn(),
  email: "viewer@example.com" as string | null,
  requestOrgId: "org-1" as string | null,
  deckRow: null as {
    id: string;
    data: string;
    ownerEmail: string;
    orgId: string | null;
  } | null,
  assets: [] as Array<Record<string, unknown>>,
  events: [] as string[],
  schema: {
    decks: {
      id: "id",
      data: "data",
      ownerEmail: "ownerEmail",
      orgId: "orgId",
    },
    uploadedAssets: {
      id: "id",
      url: "url",
      filename: "filename",
      size: "size",
      type: "type",
      deckId: "deckId",
      ownerEmail: "ownerEmail",
      orgId: "orgId",
      createdAt: "createdAt",
    },
  },
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/action", () => ({
  fail: (message: string, details: Record<string, unknown> = {}) => {
    throw Object.assign(new Error(message), details);
  },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => mocks.requestOrgId,
  getRequestUserEmail: () => mocks.email,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: Clause[]) => ({ kind: "and", conditions }),
  desc: (column: unknown) => ({ kind: "desc", column }),
  eq: (column: unknown, value: unknown) => ({
    kind: "eq",
    column,
    value,
  }),
  inArray: (column: unknown, values: unknown[]) => ({
    kind: "inArray",
    column,
    values,
  }),
  isNull: (column: unknown) => ({ kind: "isNull", column }),
  like: (column: unknown, value: string) => ({ kind: "like", column, value }),
  or: (...conditions: Clause[]) => ({ kind: "or", conditions }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: (...args: unknown[]) => mocks.select(...args) }),
  schema: mocks.schema,
}));

import action from "./list-assets";

function matches(clause: Clause, row: Record<string, unknown>): boolean {
  switch (clause.kind) {
    case "and":
      return clause.conditions.every((condition) => matches(condition, row));
    case "or":
      return clause.conditions.some((condition) => matches(condition, row));
    case "eq":
      return row[clause.column] === clause.value;
    case "inArray":
      return clause.values.includes(row[clause.column]);
    case "isNull":
      return row[clause.column] == null;
    case "like":
      return (
        typeof row[clause.column] === "string" &&
        row[clause.column].startsWith(clause.value.slice(0, -1))
      );
  }
}

function asset(
  id: string,
  type: string,
  ownerEmail: string,
  orgId: string | null,
  deckId: string | null = null,
) {
  return {
    id,
    type,
    ownerEmail,
    orgId,
    deckId,
    url: `https://assets.example.com/${id}`,
    filename: `${id}.png`,
    size: 100,
    createdAt: "2026-10-17T00:00:00.000Z",
  };
}

function setQueryImplementation() {
  mocks.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: (clause: Clause) => ({
        limit: async () => {
          mocks.events.push("deck-read");
          const deck = mocks.deckRow;
          return deck && table === mocks.schema.decks && matches(clause, deck)
            ? [
                {
                  data: deck.data,
                  ownerEmail: deck.ownerEmail,
                  orgId: deck.orgId,
                },
              ]
            : [];
        },
        orderBy: async () => {
          mocks.events.push("asset-read");
          return table === mocks.schema.uploadedAssets
            ? mocks.assets.filter((row) => matches(clause, row))
            : [];
        },
      }),
    }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.email = "viewer@example.com";
  mocks.requestOrgId = "org-1";
  mocks.deckRow = null;
  mocks.assets = [];
  mocks.events.length = 0;
  mocks.assertAccess.mockImplementation(async () => {
    mocks.events.push("access-check");
  });
  setQueryImplementation();
});

describe("list-assets", () => {
  it("keeps global results in the current workspace when no deck is specified", async () => {
    mocks.assets = [
      asset("own-org", "image/png", "viewer@example.com", "org-1"),
      asset("own-unscoped", "image/jpeg", "viewer@example.com", null),
      asset("other-user-org", "image/png", "other@example.com", "org-1"),
      asset("other-user-unscoped", "image/png", "other@example.com", null),
      asset("own-other-org", "image/png", "viewer@example.com", "org-2"),
      asset("own-video", "video/mp4", "viewer@example.com", "org-1"),
      asset("own-deck", "image/png", "viewer@example.com", "org-1", "deck-1"),
    ];

    const result = (await action.run({ scope: "global" } as never)) as Array<{
      id: string;
    }>;

    expect(result.map(({ id }) => id).sort()).toEqual(["own-org"]);
    expect(mocks.assertAccess).not.toHaveBeenCalled();
  });

  it("lists the signed-in user's global assets when there is no active organization", async () => {
    mocks.requestOrgId = null;
    mocks.assets = [
      asset("own-unscoped", "image/jpeg", "viewer@example.com", null),
      asset("other-unscoped", "image/png", "other@example.com", null),
      asset("own-org", "image/png", "viewer@example.com", "org-1"),
    ];

    const result = (await action.run({ scope: "global" } as never)) as Array<{
      id: string;
    }>;

    expect(result.map(({ id }) => id)).toEqual(["own-unscoped"]);
  });

  it("limits global results with a deck context to media that deck can resolve", async () => {
    mocks.deckRow = {
      id: "deck-1",
      ownerEmail: "deck-owner@example.com",
      orgId: "org-1",
      data: JSON.stringify({ appId: "slides-2", slides: [] }),
    };
    mocks.assets = [
      asset("owner-org-global", "image/png", "deck-owner@example.com", "org-1"),
      asset("member-org-global", "image/png", "member@example.com", "org-1"),
      asset("caller-org-global", "image/png", "viewer@example.com", "org-1"),
      asset(
        "owner-private-global",
        "image/png",
        "deck-owner@example.com",
        null,
      ),
      asset("caller-private-global", "image/png", "viewer@example.com", null),
      asset("foreign-org-global", "image/png", "viewer@example.com", "org-2"),
      asset(
        "deck-attached",
        "image/png",
        "deck-owner@example.com",
        "org-1",
        "deck-1",
      ),
    ];

    const result = (await action.run({
      scope: "global",
      deckId: "deck-1",
    } as never)) as Array<{ id: string }>;

    expect(mocks.assertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(result.map(({ id }) => id)).toEqual(["caller-org-global"]);
  });

  it("allows only the deck owner's personal assets for a personal deck", async () => {
    mocks.requestOrgId = "org-1";
    mocks.deckRow = {
      id: "personal-deck",
      ownerEmail: "viewer@example.com",
      orgId: null,
      data: JSON.stringify({ appId: "slides-2", slides: [] }),
    };
    mocks.assets = [
      asset("owner-private-global", "image/png", "viewer@example.com", null),
      asset("other-private-global", "image/png", "other@example.com", null),
      asset("owner-org-global", "image/png", "viewer@example.com", "org-1"),
    ];

    const result = (await action.run({
      scope: "global",
      deckId: "personal-deck",
    } as never)) as Array<{ id: string }>;

    expect(result.map(({ id }) => id)).toEqual(["owner-private-global"]);
  });

  it("lists supported videos from the current workspace's global collection", async () => {
    mocks.assets = [
      asset("own-mp4", "video/mp4", "viewer@example.com", "org-1"),
      asset("own-webm", "video/webm", "viewer@example.com", null),
      asset("own-unsupported", "video/quicktime", "viewer@example.com", null),
      asset("own-image", "image/png", "viewer@example.com", "org-1"),
      asset("other-video", "video/mp4", "other@example.com", "org-1"),
    ];

    const result = (await action.run({
      scope: "global",
      media: "video",
    } as never)) as Array<{ id: string; type: string }>;

    expect(result.map(({ id }) => id).sort()).toEqual(["own-mp4"]);
    expect(result.every(({ type }) => type.startsWith("video/"))).toBe(true);
  });

  it("includes supported image and video types when the caller requests all media", async () => {
    mocks.assets = [
      asset("own-image", "image/png", "viewer@example.com", "org-1"),
      asset("own-video", "video/mp4", "viewer@example.com", "org-1"),
      asset(
        "unsupported-video",
        "video/quicktime",
        "viewer@example.com",
        "org-1",
      ),
    ];

    const result = (await action.run({
      scope: "global",
      media: "all",
    } as never)) as Array<{ id: string; type: string }>;

    expect(result.map(({ id }) => id).sort()).toEqual([
      "own-image",
      "own-video",
    ]);
    expect(result.find(({ id }) => id === "own-video")?.type).toBe("video/mp4");
  });

  it("lists image assets from the accessible deck catalog within its owner/org scope", async () => {
    mocks.deckRow = {
      id: "deck-1",
      ownerEmail: "deck-owner@example.com",
      orgId: "org-1",
      data: JSON.stringify({ appId: "slides-2", slides: [] }),
    };
    mocks.assets = [
      asset(
        "same-org-uploader",
        "image/png",
        "member@example.com",
        "org-1",
        "deck-1",
      ),
      asset(
        "deck-owner",
        "image/jpeg",
        "deck-owner@example.com",
        "org-1",
        "deck-1",
      ),
      asset(
        "another-deck",
        "image/png",
        "deck-owner@example.com",
        "org-1",
        "deck-2",
      ),
      asset(
        "foreign-org",
        "image/png",
        "deck-owner@example.com",
        "org-2",
        "deck-1",
      ),
      asset("global", "image/png", "deck-owner@example.com", "org-1"),
      asset(
        "deck-video",
        "video/mp4",
        "deck-owner@example.com",
        "org-1",
        "deck-1",
      ),
    ];

    const result = (await action.run({
      scope: "deck",
      deckId: "deck-1",
    } as never)) as Array<{ id: string }>;

    expect(mocks.assertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(mocks.events).toEqual(["access-check", "deck-read", "asset-read"]);
    expect(result.map(({ id }) => id).sort()).toEqual([
      "deck-owner",
      "same-org-uploader",
    ]);
  });

  it("lists image and video assets referenced by the requested slide", async () => {
    mocks.deckRow = {
      id: "deck-1",
      ownerEmail: "deck-owner@example.com",
      orgId: "org-1",
      data: JSON.stringify({
        appId: "slides-2",
        slides: [
          {
            id: "slide-1",
            sourceTsx: `export default function Slide() { return <><img src={"asset://on-slide"} /><video src={"asset://video-on-slide"} poster={"asset://poster-on-slide"} /></>; }`,
          },
          {
            id: "slide-2",
            sourceTsx:
              'export default function Slide() { return <img src={"asset://other-slide"} />; }',
          },
        ],
      }),
    };
    mocks.assets = [
      asset("on-slide", "image/png", "member@example.com", "org-1"),
      asset("video-on-slide", "video/mp4", "member@example.com", "org-1"),
      asset("poster-on-slide", "image/png", "member@example.com", "org-1"),
      asset(
        "other-slide",
        "image/png",
        "deck-owner@example.com",
        "org-1",
        "deck-1",
      ),
      asset(
        "unused-deck-image",
        "image/png",
        "deck-owner@example.com",
        "org-1",
        "deck-1",
      ),
      asset("foreign-workspace", "image/png", "other@example.com", "org-2"),
    ];

    const result = (await action.run({
      scope: "slide",
      media: "all",
      deckId: "deck-1",
      slideId: "slide-1",
    } as never)) as Array<{ id: string; type: string }>;

    expect(mocks.assertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(mocks.events).toEqual(["access-check", "deck-read", "asset-read"]);
    expect(result.map(({ id }) => id).sort()).toEqual([
      "on-slide",
      "poster-on-slide",
      "video-on-slide",
    ]);
  });

  it("returns an empty slide scope without querying assets when no media is referenced", async () => {
    mocks.deckRow = {
      id: "deck-1",
      ownerEmail: "deck-owner@example.com",
      orgId: "org-1",
      data: JSON.stringify({
        appId: "slides-2",
        slides: [
          {
            id: "slide-1",
            sourceTsx: "export default function Slide() { return <div />; }",
          },
        ],
      }),
    };

    const result = await action.run({
      scope: "slide",
      deckId: "deck-1",
      slideId: "slide-1",
    } as never);

    expect(result).toEqual([]);
    expect(mocks.events).toEqual(["access-check", "deck-read"]);
  });

  it("rejects slide scope without a slide ID before reading the deck", async () => {
    await expect(
      action.run({ scope: "slide", deckId: "deck-1" } as never),
    ).rejects.toMatchObject({
      errorCode: "asset_deck_scope_invalid",
      statusCode: 400,
    });

    expect(mocks.events).toEqual([]);
  });

  it("hides markerless decks before reading assets", async () => {
    mocks.deckRow = {
      id: "legacy-deck",
      ownerEmail: "deck-owner@example.com",
      orgId: null,
      data: JSON.stringify({ slides: [] }),
    };
    mocks.assets = [
      asset(
        "legacy-deck-image",
        "image/png",
        "deck-owner@example.com",
        null,
        "legacy-deck",
      ),
    ];

    await expect(
      action.run({ scope: "deck", deckId: "legacy-deck" } as never),
    ).rejects.toMatchObject({
      errorCode: "deck_not_found",
      statusCode: 404,
    });

    expect(mocks.events).toEqual(["access-check", "deck-read"]);
  });

  it("hides explicitly foreign-app decks before reading assets", async () => {
    mocks.deckRow = {
      id: "foreign-deck",
      ownerEmail: "deck-owner@example.com",
      orgId: "org-1",
      data: JSON.stringify({ appId: "slides", slides: [] }),
    };
    mocks.assets = [
      asset(
        "foreign-deck-image",
        "image/png",
        "deck-owner@example.com",
        "org-1",
        "foreign-deck",
      ),
    ];

    await expect(
      action.run({ scope: "deck", deckId: "foreign-deck" } as never),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mocks.events).toEqual(["access-check", "deck-read"]);
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });

  it("hides malformed non-object deck data before reading assets", async () => {
    mocks.deckRow = {
      id: "malformed-deck",
      ownerEmail: "deck-owner@example.com",
      orgId: "org-1",
      data: JSON.stringify([]),
    };

    await expect(
      action.run({ scope: "deck", deckId: "malformed-deck" } as never),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: "deck_not_found" });

    expect(mocks.events).toEqual(["access-check", "deck-read"]);
  });

  it("does not read deck data when editor access is denied", async () => {
    const denied = Object.assign(new Error("No access to deck private-deck"), {
      statusCode: 403,
    });
    mocks.assertAccess.mockImplementation(async () => {
      mocks.events.push("access-check");
      throw denied;
    });

    await expect(
      action.run({ scope: "deck", deckId: "private-deck" } as never),
    ).rejects.toMatchObject({
      message: "You don't have access to this presentation's images.",
      errorCode: "asset_deck_access_denied",
      statusCode: 403,
    });

    expect(mocks.events).toEqual(["access-check"]);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("returns a typed not-found result without exposing inaccessible deck IDs", async () => {
    mocks.assertAccess.mockImplementation(async () => {
      mocks.events.push("access-check");
      throw Object.assign(new Error("Deck secret-deck-id was not found"), {
        statusCode: 404,
      });
    });

    await expect(
      action.run({ scope: "deck", deckId: "secret-deck-id" } as never),
    ).rejects.toMatchObject({
      message: "Deck not found.",
      errorCode: "deck_not_found",
      statusCode: 404,
    });

    expect(mocks.events).toEqual(["access-check"]);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("uses a typed sign-in error for an unauthenticated global list", async () => {
    mocks.email = null;

    await expect(
      action.run({ scope: "global" } as never),
    ).rejects.toMatchObject({
      errorCode: "asset_list_auth_required",
      statusCode: 401,
    });
  });

  it("does not expose database diagnostics when listing fails", async () => {
    mocks.select.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          orderBy: async () => {
            throw new Error("postgres connection string must stay private");
          },
        }),
      }),
    }));

    await expect(
      action.run({ scope: "global" } as never),
    ).rejects.toMatchObject({
      message: "Could not load uploaded images.",
      errorCode: "asset_list_failed",
      statusCode: 500,
    });
  });

  it("requires deck context for deck and slide scopes", () => {
    expect(() => action.schema.parse({ scope: "deck" })).toThrow();
    expect(() =>
      action.schema.parse({ scope: "slide", deckId: "deck-1" }),
    ).toThrow();
    expect(() =>
      action.schema.parse({
        scope: "deck",
        deckId: "deck-1",
        slideId: "slide-1",
      }),
    ).toThrow();
    expect(() =>
      action.schema.parse({ scope: "global", slideId: "slide-1" }),
    ).toThrow();
    expect(
      action.schema.parse({
        scope: "slide",
        deckId: "deck-1",
        slideId: "slide-1",
      }),
    ).toMatchObject({ scope: "slide", deckId: "deck-1", slideId: "slide-1" });
    expect(
      action.schema.parse({ scope: "global", deckId: "deck-1" }),
    ).toMatchObject({ scope: "global", deckId: "deck-1" });
    expect(() => action.schema.parse({ scope: "slide" })).toThrow();
  });
});
