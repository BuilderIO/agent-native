import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createExportArtifact: vi.fn(),
  resolveAccess: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "owner@example.com",
}));
vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: vi.fn(),
}));
vi.mock("../server/db/index.js", () => ({}));
vi.mock("../server/lib/import-asset-storage.js", () => ({
  readLocalImportedAsset: vi.fn(),
}));
vi.mock("../server/lib/export-artifacts.js", () => ({
  createExportArtifact: mocks.createExportArtifact,
}));

import action from "./export-pptx.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveAccess.mockResolvedValue({
    resource: {
      title: "Quarterly Deck",
      data: JSON.stringify({
        slides: [
          {
            id: "slide-1",
            content: '<div class="fmd-slide"><h1>Quarterly</h1></div>',
          },
        ],
      }),
    },
  });
});

describe("export-pptx", () => {
  it("returns exactly the download artifact contract after generating PPTX bytes", async () => {
    const artifact = {
      downloadUrl:
        "https://slides.example.test/api/exports/download?artifact=export-1&token=token",
      filename: "Quarterly-Deck.pptx",
      expiresAt: "2026-08-27T12:10:00.000Z",
    };
    mocks.createExportArtifact.mockResolvedValue(artifact);

    await expect(
      action.run({ deckId: "deck-1", includeNotes: true }),
    ).resolves.toEqual(artifact);
    expect(mocks.createExportArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: expect.stringMatching(/\.pptx$/),
        ownerEmail: "owner@example.com",
        data: expect.any(Uint8Array),
      }),
    );
  });
});
