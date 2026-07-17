import { describe, expect, it, vi } from "vitest";

import { recommendContextRoots } from "./recommendations.js";
import { smartDefaultExternalIds } from "./smart-defaults.js";
import type { ContextConnectorInventoryItem } from "./types.js";

describe("creative context smart defaults", () => {
  it("ranks shared recent Slides decks and excludes drafts and tiny decks", () => {
    const items: ContextConnectorInventoryItem[] = [
      item("personal", "Personal launch", "2026-07-15T00:00:00.000Z"),
      item("shared", "Shared launch", "2026-07-14T00:00:00.000Z", {
        accessSignals: { shared: true, driveId: "drive-1" },
        slideCount: 8,
      }),
      item("copy", "Copy of Launch", "2026-07-16T00:00:00.000Z"),
      item("test", "Launch TEST deck", "2026-07-16T00:00:00.000Z"),
      item("tiny", "Tiny deck", "2026-07-16T00:00:00.000Z", {
        slideCount: 2,
      }),
      item("old", "Old deck", "2024-01-01T00:00:00.000Z"),
    ];

    expect(
      smartDefaultExternalIds({
        kind: "google-slides",
        items,
        now: new Date("2026-07-16T00:00:00.000Z"),
      }),
    ).toEqual(["shared", "personal"]);
  });

  it("lets canonical and pinned decks override viability filters and caps at 15", () => {
    const items = Array.from({ length: 20 }, (_, index) =>
      item(
        `deck-${index}`,
        index === 19 ? "Copy of canonical" : `Deck ${index}`,
        `2026-07-${String((index % 15) + 1).padStart(2, "0")}T00:00:00.000Z`,
      ),
    );
    const selected = smartDefaultExternalIds({
      kind: "google-slides",
      items,
      canonicalExternalIds: ["deck-19"],
      now: new Date("2026-07-16T00:00:00.000Z"),
    });

    expect(selected).toHaveLength(15);
    expect(selected[0]).toBe("deck-19");
  });

  it("keeps explicit-boundary connectors fully selected for confirmation", () => {
    expect(
      smartDefaultExternalIds({
        kind: "notion",
        items: [item("page", "Page", "2026-07-16T00:00:00.000Z")],
      }),
    ).toEqual(["page"]);
  });
});

describe("provider-backed root recommendations", () => {
  it("uses Notion search without persisting or treating results as a boundary", async () => {
    const executeRequest = vi.fn(async () => ({
      results: [
        {
          id: "page-1",
          url: "https://notion.so/page-1",
          last_edited_time: "2026-07-15T00:00:00.000Z",
          properties: {
            Name: { title: [{ plain_text: "Brand home" }] },
          },
        },
      ],
    }));
    const result = await recommendContextRoots(
      { provider: "notion", connectionId: "conn-1" },
      {
        appId: "slides",
        providerApi: { executeRequest },
        resolveConnection: vi.fn(async () => "conn-1"),
      },
    );

    expect(executeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "notion",
        method: "POST",
        path: "/search",
        connectionId: "conn-1",
      }),
    );
    expect(result).toMatchObject({
      persisted: false,
      requiresExplicitBoundary: true,
      recommendations: [
        expect.objectContaining({
          externalId: "page-1",
          title: "Brand home",
          metadata: { recommendationOnly: true },
        }),
      ],
    });
  });

  it("explains why Figma recommendations need an explicit team or project", async () => {
    const executeRequest = vi.fn();
    const result = await recommendContextRoots(
      { provider: "figma", connectionId: "conn-1" },
      {
        appId: "design",
        providerApi: { executeRequest },
        resolveConnection: vi.fn(async () => "conn-1"),
      },
    );

    expect(result.recommendations).toEqual([]);
    expect(result.unavailableReason).toMatch(/no global recent-files API/i);
    expect(executeRequest).not.toHaveBeenCalled();
  });
});

function item(
  externalId: string,
  title: string,
  sourceModifiedAt: string,
  metadata?: Record<string, unknown>,
): ContextConnectorInventoryItem {
  return {
    externalId,
    kind: "google-slides-presentation",
    title,
    sourceModifiedAt,
    metadata,
  };
}
