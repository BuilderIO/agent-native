import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    rows: [] as Array<Record<string, unknown>>,
    assetRows: [] as Array<Record<string, unknown>>,
    where: undefined as unknown,
    insertMode: "success" as "success" | "fail" | "fail-after-commit",
    appState: new Map<string, Record<string, unknown>>(),
  };
  const schema = {
    uploadedAssets: {
      id: "uploaded_assets.id",
      ownerEmail: "uploaded_assets.owner_email",
      orgId: "uploaded_assets.org_id",
      deckId: "uploaded_assets.deck_id",
      filename: "uploaded_assets.filename",
      url: "uploaded_assets.url",
      type: "uploaded_assets.type",
      size: "uploaded_assets.size",
      fontFamily: "uploaded_assets.font_family",
      fontVariant: "uploaded_assets.font_variant",
    },
  };
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
  };
  db.select.mockImplementation((selection: Record<string, unknown>) => ({
    from: () => ({
      where: (condition: unknown) => {
        state.where = condition;
        const rows = Object.hasOwn(selection, "fontFamily")
          ? state.rows
          : state.assetRows;
        const query = Promise.resolve(rows) as Promise<
          Array<Record<string, unknown>>
        > & {
          limit: (count: number) => Promise<Array<Record<string, unknown>>>;
        };
        query.limit = async (count) => rows.slice(0, count);
        return query;
      },
    }),
  }));
  db.insert.mockImplementation(() => ({
    values: async (row: Record<string, unknown>) => {
      if (state.insertMode === "fail-after-commit") state.assetRows.push(row);
      if (state.insertMode !== "success") throw new Error("insert failed");
      state.assetRows.push(row);
    },
  }));
  return {
    state,
    db,
    schema,
    deleteFile: vi.fn(),
    uploadFile: vi.fn(),
    assertDeckAssetUploadScope: vi.fn(),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
  inArray: (left: unknown, right: unknown) => ({ inArray: [left, right] }),
  isNull: (column: unknown) => ({ isNull: column }),
  or: (...args: unknown[]) => ({ or: args }),
}));

vi.mock("@agent-native/core/application-state", () => ({
  deleteAppState: async (key: string) => mocks.state.appState.delete(key),
  listAppState: async (prefix: string) =>
    [...mocks.state.appState.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value })),
  writeAppState: async (key: string, value: Record<string, unknown>) => {
    mocks.state.appState.set(key, value);
  },
}));

vi.mock("@agent-native/core/file-upload", () => ({
  deleteUploadedFile: (...args: unknown[]) => mocks.deleteFile(...args),
  uploadFile: (...args: unknown[]) => mocks.uploadFile(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (_context: unknown, callback: () => unknown) =>
    callback(),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => mocks.db,
  schema: mocks.schema,
}));

vi.mock("../lib/deck-asset-scope.js", () => ({
  assertDeckAssetUploadScope: (...args: unknown[]) =>
    mocks.assertDeckAssetUploadScope(...args),
}));

import {
  importGoogleFontAsset,
  reapOrphanedFontAssetObjects,
  resolveSlideDesignFontAssets,
  UploadedFontError,
} from "./uploaded-fonts";

const tokens = {
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

function googleFont() {
  return {
    data: Buffer.from("font-data"),
    extension: "woff2" as const,
    mimeType: "font/woff2",
    family: "Inter",
    variant: "400" as const,
  };
}

describe("uploaded Slides 2 fonts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.rows = [
      {
        id: "font-1",
        deckId: "deck-1",
        filename: "font-inter-400.woff2",
        url: "https://storage.example.test/fonts/inter.woff2",
        type: "font/woff2",
        fontFamily: "Inter",
        fontVariant: "400",
      },
    ];
    mocks.state.assetRows = [];
    mocks.state.where = undefined;
    mocks.state.insertMode = "success";
    mocks.state.appState.clear();
    mocks.uploadFile.mockResolvedValue({
      url: "https://storage.example.test/fonts/inter.woff2",
      id: "font-object-1",
      provider: "s3",
    });
    mocks.deleteFile.mockResolvedValue(true);
  });

  it("resolves only a registered family and scopes the SQL lookup to its owner and org", async () => {
    await expect(
      resolveSlideDesignFontAssets(tokens, {
        deckId: "deck-1",
        ownerEmail: "owner@example.com",
        orgId: "org-1",
      }),
    ).resolves.toEqual([
      {
        assetId: "font-1",
        family: "Inter",
        variant: "400",
        mimeType: "font/woff2",
        url: "https://storage.example.test/fonts/inter.woff2",
      },
    ]);

    expect(mocks.state.where).toEqual({
      and: [
        { inArray: ["uploaded_assets.id", ["font-1"]] },
        { eq: ["uploaded_assets.deck_id", "deck-1"] },
        {
          or: [
            {
              and: [
                { eq: ["uploaded_assets.owner_email", "owner@example.com"] },
                { eq: ["uploaded_assets.org_id", "org-1"] },
              ],
            },
            { eq: ["uploaded_assets.org_id", "org-1"] },
          ],
        },
      ],
    });
  });

  it("rejects an asset registered under a different family", async () => {
    mocks.state.rows = [{ ...mocks.state.rows[0], fontFamily: "Other" }];

    await expect(
      resolveSlideDesignFontAssets(tokens, {
        deckId: "deck-1",
        ownerEmail: "owner@example.com",
        orgId: "org-1",
      }),
    ).rejects.toBeInstanceOf(UploadedFontError);
  });

  it("rejects an asset registered to a different deck", async () => {
    mocks.state.rows = [{ ...mocks.state.rows[0], deckId: "deck-2" }];

    await expect(
      resolveSlideDesignFontAssets(tokens, {
        deckId: "deck-1",
        ownerEmail: "owner@example.com",
        orgId: "org-1",
      }),
    ).rejects.toBeInstanceOf(UploadedFontError);
  });

  it("rejects non-HTTPS asset URLs outside the current local app origin", async () => {
    mocks.state.rows = [
      {
        ...mocks.state.rows[0],
        url: "http://attacker.example.test/font.woff2",
      },
    ];

    await expect(
      resolveSlideDesignFontAssets(tokens, {
        deckId: "deck-1",
        ownerEmail: "owner@example.com",
        orgId: "org-1",
      }),
    ).rejects.toBeInstanceOf(UploadedFontError);
  });

  it("retains failed cleanup evidence and retries deletion on a later pass", async () => {
    mocks.state.rows = [];
    mocks.state.insertMode = "fail";
    mocks.deleteFile.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(
      importGoogleFontAsset({
        email: "owner@example.com",
        orgId: "org-1",
        deckId: "deck-1",
        font: googleFont(),
      }),
    ).rejects.toMatchObject({ errorCode: "google_font_registration_failed" });

    expect(mocks.state.appState.size).toBe(1);
    await reapOrphanedFontAssetObjects("owner@example.com", "org-1");
    expect(mocks.state.appState.size).toBe(0);
    expect(mocks.deleteFile).toHaveBeenCalledTimes(2);
  });

  it("preserves a font file when a failed insert actually committed its row", async () => {
    mocks.state.rows = [];
    mocks.state.insertMode = "fail-after-commit";

    await expect(
      importGoogleFontAsset({
        email: "owner@example.com",
        orgId: "org-1",
        deckId: "deck-1",
        font: googleFont(),
      }),
    ).rejects.toMatchObject({ errorCode: "google_font_registration_failed" });

    expect(mocks.state.assetRows).toHaveLength(1);
    expect(mocks.state.appState.size).toBe(0);
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });
});
