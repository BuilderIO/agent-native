import { describe, expect, it } from "vitest";

import { localizeSlidesChangelog } from "./localize-slides-changelog";

describe("localizeSlidesChangelog", () => {
  it("localizes the current release notes and preserves historical entries", () => {
    const historicalBody =
      "Generated slides now appear inline in the agent chat, with actions to open the deck or keep building.";
    const markdown = [
      "## October 20, 2026",
      "The editor highlights hovered objects and keeps image replace and crop actions on the canvas.",
      "The slide-list toggle, deck title, and Present button now match the shared workspace controls.",
      "Google Slides imports now report missing image data instead of adding empty images.",
      "Scope global media picks to assets the current deck can resolve.",
      "Images used by saved slides stay available in your library.",
      "## October 19, 2026",
      historicalBody,
    ].join("\n");

    const localized = localizeSlidesChangelog(markdown, {
      editorHoveredObjects: "Editor note in this locale.",
      deckEditingControls: "Deck controls note in this locale.",
      googleSlidesMissingImageData: "Import note in this locale.",
      globalMediaPickerScope: "Media picker note in this locale.",
      savedSlideImages: "Saved slide images note in this locale.",
    });

    expect(localized).toContain("Editor note in this locale.");
    expect(localized).toContain("Deck controls note in this locale.");
    expect(localized).toContain("Import note in this locale.");
    expect(localized).toContain("Media picker note in this locale.");
    expect(localized).toContain("Saved slide images note in this locale.");
    expect(localized).not.toContain("The editor highlights hovered objects");
    expect(localized).not.toContain("The slide-list toggle");
    expect(localized).not.toContain("Google Slides imports now report");
    expect(localized).not.toContain("Scope global media picks");
    expect(localized).not.toContain("Images used by saved slides");
    expect(localized).toContain(historicalBody);
  });
});
