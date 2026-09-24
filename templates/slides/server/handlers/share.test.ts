import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadBody = vi.hoisted(() => vi.fn());
const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockResolveAccess = vi.hoisted(() => vi.fn());
const mockResolveSlidesRequestAuth = vi.hoisted(() => vi.fn());
const mockWithSlidesRequestContext = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockGetRouterParam = vi.hoisted(() => vi.fn());
const mockSelectLimit = vi.hoisted(() => vi.fn());
const mockAssertBuilderDsiAccess = vi.hoisted(() => vi.fn());
const insertedRows = vi.hoisted(() => ({ current: [] as unknown[] }));

const mockInsertValues = vi.hoisted(() =>
  vi.fn(async (row: unknown) => {
    insertedRows.current.push(row);
  }),
);
const mockDeleteWhere = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: (...args: unknown[]) => mockGetRouterParam(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  lt: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  readBody: (...args: unknown[]) => mockReadBody(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
  ForbiddenError: class ForbiddenError extends Error {
    statusCode = 403;
  },
}));

vi.mock("../db", () => ({
  getDb: () => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: mockSelectLimit })),
      })),
    })),
    insert: vi.fn(() => ({ values: mockInsertValues })),
    delete: vi.fn(() => ({ where: mockDeleteWhere })),
  }),
  schema: {
    deckShareLinks: {
      token: "token_col",
      title: "title_col",
      slides: "slides_col",
      aspectRatio: "aspect_ratio_col",
      designSystemData: "design_system_data_col",
      createdAt: "created_at_col",
    },
  },
}));

vi.mock("./request-auth-context.js", () => ({
  resolveSlidesRequestAuth: (...args: unknown[]) =>
    mockResolveSlidesRequestAuth(...args),
  withSlidesRequestContext: (...args: unknown[]) =>
    mockWithSlidesRequestContext(...args),
}));

vi.mock("@agent-native/core/server/builder-dsi-access", () => ({
  assertBuilderDsiAccess: (...args: unknown[]) =>
    mockAssertBuilderDsiAccess(...args),
  getBuilderDsiAccess: vi.fn(async () => ({
    status: "missing",
    eligible: false,
  })),
}));

import { getSharedDeck, shareDeck } from "./share";

const presentationStyles = {
  colors: {
    primary: "#123456",
    secondary: "#234567",
    accent: "#345678",
    background: "#000000",
    surface: "#111111",
    text: "#ffffff",
    textMuted: "#aaaaaa",
  },
  typography: {
    headingFont: "Inter",
    bodyFont: "Arial",
    headingWeight: "700",
    bodyWeight: "400",
    headingSizes: { h1: "56px", h2: "34px", h3: "24px" },
  },
  spacing: { slidePadding: "64px", elementGap: "18px" },
  borders: { radius: "14px", accentWidth: "3px" },
  slideDefaults: { background: "#000000", labelStyle: "uppercase" },
  logos: [
    { url: "https://example.com/logo.svg", name: "Logo", variant: "auto" },
  ],
  customCSS: ".brand { letter-spacing: .02em; }",
};

const internalSystemData = {
  ...presentationStyles,
  source: "builder",
  builderId: "private-builder-system",
  builderSpaceId: "private-space",
  builderDocument: { content: "private provider document" },
  docs: [{ content: "private component documentation" }],
  sources: [{ url: "https://example.com/private-source" }],
  authoring: {
    sources: [{ uploadId: "private-upload" }],
    artifacts: [{ html: "<p>private system artifact</p>" }],
    prompt: "private authoring context",
  },
  notes: "private instructions",
  imageStyle: {
    referenceUrls: ["https://example.com/private-reference.png"],
    styleDescription: "private generation guidance",
  },
  colors: {
    ...presentationStyles.colors,
    internal: { docs: "private colors" },
  },
  typography: {
    ...presentationStyles.typography,
    headingSizes: {
      ...presentationStyles.typography.headingSizes,
      docs: "private sizes",
    },
    docs: "private typography",
  },
  logos: [{ ...presentationStyles.logos[0], uploadId: "private-logo-upload" }],
};

describe("deck share snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedRows.current = [];
    mockAssertBuilderDsiAccess.mockRejectedValue(
      new Error("builder_dsi_missing"),
    );
    mockGetRouterParam.mockReturnValue("public-token");
    mockSelectLimit.mockResolvedValue([]);
    mockReadBody.mockResolvedValue({ deck: { id: "deck-1" } });
    mockResolveSlidesRequestAuth.mockResolvedValue({
      ok: true,
      context: { email: "owner@example.com" },
    });
    mockWithSlidesRequestContext.mockImplementation(async (_event, callback) =>
      callback(),
    );
    mockAssertAccess.mockResolvedValue({
      resource: {
        title: "Launch review",
        data: JSON.stringify({
          aspectRatio: "16:9",
          designSystemId: "design-system-1",
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
    });
    mockResolveAccess.mockResolvedValue({
      resource: {
        data: JSON.stringify({
          colors: {
            primary: "#123456",
            secondary: "#234567",
            accent: "#345678",
            background: "#000000",
            surface: "#111111",
            text: "#ffffff",
            textMuted: "#aaaaaa",
          },
        }),
      },
    });
  });

  it("keeps presentation animation metadata in share snapshots without speaker notes", async () => {
    const result = await shareDeck({} as any);

    expect(result).toEqual({ shareToken: expect.any(String) });
    expect(insertedRows.current).toHaveLength(1);

    const row = insertedRows.current[0] as Record<string, unknown>;
    const slides = JSON.parse(row.slides as string);

    expect(slides).toEqual([
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
    expect(row.designSystemData).toBe(
      JSON.stringify({
        colors: {
          primary: "#123456",
          secondary: "#234567",
          accent: "#345678",
          background: "#000000",
          surface: "#111111",
          text: "#ffffff",
          textMuted: "#aaaaaa",
        },
      }),
    );
    expect(mockResolveAccess).toHaveBeenCalledWith(
      "design-system",
      "design-system-1",
    );
    expect(mockAssertAccess).toHaveBeenCalledWith("deck", "deck-1", "admin");
  });

  it("publishes rendering tokens without raw DSI data or requiring Builder linkage", async () => {
    mockResolveAccess.mockResolvedValue({
      resource: { data: JSON.stringify(internalSystemData) },
    });

    expect(await shareDeck({} as any)).toEqual({
      shareToken: expect.any(String),
    });

    const row = insertedRows.current[0] as Record<string, unknown>;
    expect(JSON.parse(row.designSystemData as string)).toEqual(
      presentationStyles,
    );
    expect(JSON.parse(row.slides as string)[0].content).toBe("<h1>Launch</h1>");
    expect(mockAssertBuilderDsiAccess).not.toHaveBeenCalled();
  });

  it("keeps deck sharing resource-scoped when its system is not accessible", async () => {
    mockResolveAccess.mockResolvedValue(null);

    expect(await shareDeck({} as any)).toEqual({
      shareToken: expect.any(String),
    });
    expect(insertedRows.current[0]).toMatchObject({ designSystemData: null });
    expect(mockAssertAccess).toHaveBeenCalledWith("deck", "deck-1", "admin");
  });

  it.each([
    ["Builder", internalSystemData],
    [
      "authoring without a provider marker",
      { ...internalSystemData, source: "custom" },
    ],
    ["curated", presentationStyles],
  ])(
    "serves only presentation styles from existing %s snapshots anonymously",
    async (_label, system) => {
      const slides = [
        {
          id: "published-slide",
          content:
            '<section style="color:var(--ds-primary)"><h1>Published</h1></section>',
          notes: "",
          animations: [
            {
              id: "anim-1",
              elementIndex: 0,
              elementPath: [1, 0],
              type: "fade",
            },
          ],
          transition: "fade",
        },
      ];
      const snapshot = {
        title: "Published deck",
        slides: JSON.stringify(slides),
        aspectRatio: "16:9",
        designSystemData: JSON.stringify(system),
        createdAt: new Date().toISOString(),
      };
      mockSelectLimit.mockResolvedValue([snapshot]);

      expect(await getSharedDeck({} as any)).toEqual({
        title: "Published deck",
        slides,
        aspectRatio: "16:9",
        designSystem: presentationStyles,
      });
      expect(snapshot.designSystemData).toBe(JSON.stringify(system));
      expect(mockResolveSlidesRequestAuth).not.toHaveBeenCalled();
      expect(mockAssertAccess).not.toHaveBeenCalled();
      expect(mockResolveAccess).not.toHaveBeenCalled();
      expect(mockAssertBuilderDsiAccess).not.toHaveBeenCalled();
      expect(mockInsertValues).not.toHaveBeenCalled();
      expect(mockDeleteWhere).not.toHaveBeenCalled();
    },
  );
});
