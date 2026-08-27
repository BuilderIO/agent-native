import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createExportArtifact: vi.fn(),
  resolveAccess: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: <T>(action: T) => action,
  fail: (message: string) => new Error(message),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "owner@example.com",
}));
vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));
vi.mock("../server/db/index.js", () => ({}));
vi.mock("../server/lib/export-artifacts.js", () => ({
  createExportArtifact: mocks.createExportArtifact,
}));

import action from "./export-html.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveAccess.mockResolvedValue({
    resource: {
      title: "Quarterly Deck",
      data: JSON.stringify({
        slides: [{ id: "slide-1", content: '<div class="fmd-slide">Hi</div>' }],
      }),
    },
  });
});

describe("export-html", () => {
  it("returns exactly the download artifact contract", async () => {
    const artifact = {
      downloadUrl:
        "https://slides.example.test/api/exports/download?artifact=export-1&token=token",
      filename: "Quarterly-Deck.html",
      expiresAt: "2026-08-27T12:10:00.000Z",
    };
    mocks.createExportArtifact.mockResolvedValue(artifact);

    await expect(action.run({ deckId: "deck-1" })).resolves.toEqual(artifact);
    expect(Object.keys(await action.run({ deckId: "deck-1" })).sort()).toEqual([
      "downloadUrl",
      "expiresAt",
      "filename",
    ]);
  });

  it("fails rather than returning a successful error envelope for an empty deck", async () => {
    mocks.resolveAccess.mockResolvedValue({
      resource: { title: "Empty", data: JSON.stringify({ slides: [] }) },
    });

    await expect(action.run({ deckId: "deck-1" })).rejects.toThrow(
      "Cannot export an empty deck.",
    );
  });
});
