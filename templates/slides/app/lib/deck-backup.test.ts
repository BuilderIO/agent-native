import { describe, expect, it } from "vitest";

import type { Deck } from "@/context/DeckContext";

import {
  DeckBackupError,
  parseDeckBackup,
  serializeDeckBackup,
} from "./deck-backup";

const deck: Deck = {
  id: "deck-1",
  title: "Quarterly Review",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  createdByMe: true,
  visibility: "private",
  shareToken: "share-token-placeholder",
  aspectRatio: "4:3",
  designSystemId: "brand-1",
  tweaks: { titleCase: true, accent: "#123456" },
  starred: true,
  previewSlide: {
    id: "preview",
    content: "stale preview",
    notes: "",
    layout: "content",
  },
  slides: [
    {
      id: "slide-1",
      content: '<div class="fmd-slide"><h1>Review</h1></div>',
      notes: "Say this out loud",
      layout: "title",
      imageLoading: true,
      transition: "fade",
    },
  ],
};

describe("Slides deck backups", () => {
  it("round-trips editable deck data without identity or transient fields", () => {
    const backup = parseDeckBackup(serializeDeckBackup(deck));

    expect(backup.deck).toMatchObject({
      title: "Quarterly Review",
      aspectRatio: "4:3",
      designSystemId: "brand-1",
      tweaks: { titleCase: true, accent: "#123456" },
      starred: true,
    });
    expect(backup.deck.slides).toEqual([
      {
        id: "slide-1",
        content: '<div class="fmd-slide"><h1>Review</h1></div>',
        notes: "Say this out loud",
        layout: "title",
        transition: "fade",
      },
    ]);
    expect(JSON.stringify(backup)).not.toContain("share-token-placeholder");
    expect(JSON.stringify(backup)).not.toContain("preview");
  });

  it("rejects malformed or ambiguous backup files", () => {
    expect(() => parseDeckBackup("{}")).toThrowError(DeckBackupError);
    expect(() =>
      parseDeckBackup(
        JSON.stringify({
          format: "agent-native-slides-deck",
          version: 1,
          deck: {
            title: "Broken",
            slides: [
              { id: "same", content: "one" },
              { id: "same", content: "two" },
            ],
          },
        }),
      ),
    ).toThrowError(DeckBackupError);
  });
});
