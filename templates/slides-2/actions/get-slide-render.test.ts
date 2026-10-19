import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  buildRuntime: vi.fn(),
  compileSource: vi.fn(),
  limit: vi.fn(),
  resolveFonts: vi.fn(),
}));

const selectChain = {
  from: vi.fn(),
  where: vi.fn(),
  limit: mocks.limit,
};
selectChain.from.mockReturnValue(selectChain);
selectChain.where.mockReturnValue(selectChain);

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ left, right }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: () => selectChain }),
  schema: {
    decks: {
      id: "deck_id",
      ownerEmail: "owner_email",
      orgId: "org_id",
      data: "deck_data",
    },
  },
}));

vi.mock("../server/lib/slide-worker-runtime.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../server/lib/slide-worker-runtime.js")
    >();
  return {
    ...actual,
    buildReactSlideRuntime: (...args: unknown[]) => mocks.buildRuntime(...args),
  };
});

vi.mock("../server/lib/uploaded-fonts.js", () => ({
  resolveSlideDesignFontAssets: (...args: unknown[]) =>
    mocks.resolveFonts(...args),
}));

vi.mock("./_slide-source.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_slide-source.js")>();
  return {
    ...actual,
    compileSlideSource: (...args: unknown[]) => mocks.compileSource(...args),
  };
});

import { hashSlideSource } from "../server/lib/slide-source.js";
import action from "./get-slide-render.js";

const sourceTsx = "export default function Slide() { return <main />; }";
const sourceHash = hashSlideSource(sourceTsx);
const workerRuntime = {
  kind: "open-slide-react-worker-v1",
  workerSource: "self.onmessage = () => {};",
  page: { current: 2, total: 3 },
  assetUrls: { "asset-a": "https://cdn.example.com/a.png" },
  styles: [],
  timeoutMs: 2500,
};

describe("get-slide-render", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectChain.from.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
    mocks.limit.mockResolvedValue([
      {
        id: "deck-1",
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [
            {
              id: "slide-1",
              sourceTsx: "export default function First() {}",
              content: "",
            },
            { id: "slide-2", sourceTsx, sourceHash, revision: 4, content: "" },
            {
              id: "slide-3",
              sourceTsx: "export default function Third() {}",
              content: "",
            },
          ],
        }),
      },
    ]);
    mocks.compileSource.mockResolvedValue({
      sourceHash,
      content: "",
      assetUrls: new Map([["asset-a", "https://cdn.example.com/a.png"]]),
      assetOrigins: ["https://cdn.example.com"],
    });
    mocks.buildRuntime.mockResolvedValue(workerRuntime);
    mocks.resolveFonts.mockResolvedValue([]);
  });

  it("returns the opaque Worker artifact and source identity for an imported React module", async () => {
    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-2",
    })) as Record<string, any>;

    expect(mocks.assertAccess).toHaveBeenCalledWith("deck", "deck-1", "viewer");
    expect(mocks.buildRuntime).toHaveBeenCalledWith(sourceTsx, {
      current: 2,
      total: 3,
      assetUrls: new Map([["asset-a", "https://cdn.example.com/a.png"]]),
    });
    expect(result).toMatchObject({
      protocolVersion: 1,
      deckId: "deck-1",
      slideId: "slide-2",
      revision: 4,
      sourceHash,
      width: 1920,
      height: 1080,
      html: "",
      assetOrigins: ["https://cdn.example.com"],
      runtime: workerRuntime,
    });
  });

  it("renders a saved slide in a deck with more than 40 slides", async () => {
    const slides = Array.from({ length: 41 }, (_, index) =>
      index === 40
        ? {
            id: "slide-41",
            sourceTsx,
            sourceHash,
            revision: 4,
            content: "",
          }
        : { id: `slide-${index + 1}`, content: "" },
    );
    mocks.limit.mockResolvedValue([
      {
        id: "deck-1",
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        data: JSON.stringify({ appId: "slides-2", slides }),
      },
    ]);
    mocks.buildRuntime.mockResolvedValue({
      ...workerRuntime,
      page: { current: 41, total: 41 },
    });

    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-41",
    })) as Record<string, any>;

    expect(mocks.buildRuntime).toHaveBeenCalledWith(sourceTsx, {
      current: 41,
      total: 41,
      assetUrls: new Map([["asset-a", "https://cdn.example.com/a.png"]]),
    });
    expect(result.runtime.page).toEqual({ current: 41, total: 41 });
  });

  it("returns only the registered font handles selected by deck tokens", async () => {
    const designTokens = {
      background: "#ffffff",
      text: "#111827",
      accent: "#2563eb",
      displayFont: "Inter",
      displayFontAssetId: "font-1",
      bodyFont: "Arial",
      heroScale: 1,
      bodyScale: 1,
      radius: 12,
    };
    const fontAssets = [
      {
        assetId: "font-1",
        family: "Inter",
        variant: "400",
        mimeType: "font/woff2",
        url: "https://storage.example.test/fonts/inter.woff2",
      },
    ];
    mocks.limit.mockResolvedValue([
      {
        id: "deck-1",
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        data: JSON.stringify({
          appId: "slides-2",
          designTokens,
          slides: [
            {
              id: "slide-1",
              sourceTsx: "export default function First() {}",
              content: "",
            },
            { id: "slide-2", sourceTsx, sourceHash, revision: 4, content: "" },
          ],
        }),
      },
    ]);
    mocks.resolveFonts.mockResolvedValue(fontAssets);

    const result = (await action.run({
      deckId: "deck-1",
      slideId: "slide-2",
    })) as Record<string, any>;

    expect(mocks.resolveFonts).toHaveBeenCalledWith(designTokens, {
      deckId: "deck-1",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    expect(result).toMatchObject({
      designTokens,
      fontAssets,
      fontOrigins: ["https://storage.example.test"],
    });
  });
});
