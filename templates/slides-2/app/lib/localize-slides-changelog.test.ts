import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import arSaMessages from "../i18n/ar-SA";
import deDeMessages from "../i18n/de-DE";
import esMessages from "../i18n/es-ES";
import frFrMessages from "../i18n/fr-FR";
import hiInMessages from "../i18n/hi-IN";
import jaJpMessages from "../i18n/ja-JP";
import koKrMessages from "../i18n/ko-KR";
import ptBrMessages from "../i18n/pt-BR";
import zhCnMessages from "../i18n/zh-CN";
import zhTwMessages from "../i18n/zh-TW";
import { localizeSlidesChangelog } from "./localize-slides-changelog";

const translatedChangelogCatalogs = [
  ["ar-SA", arSaMessages.slidesChangelog],
  ["de-DE", deDeMessages.slidesChangelog],
  ["es-ES", esMessages.slidesChangelog],
  ["fr-FR", frFrMessages.slidesChangelog],
  ["hi-IN", hiInMessages.slidesChangelog],
  ["ja-JP", jaJpMessages.slidesChangelog],
  ["ko-KR", koKrMessages.slidesChangelog],
  ["pt-BR", ptBrMessages.slidesChangelog],
  ["zh-CN", zhCnMessages.slidesChangelog],
  ["zh-TW", zhTwMessages.slidesChangelog],
] as const;

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
      "Presenter controls use shared workspace buttons and inputs",
      "The presenter console previews each remaining build step before moving to the next slide.",
      "Stale slide previews clear before a different slide loads",
      "Document and slide media transfers stop within safe size and time limits",
      "The slide editor follows your selected app theme across the canvas and selected-object controls.",
      "Style text with typography and color controls, then edit it directly on the slide.",
      "Images used by saved slides stay available in your library.",
      "Slide editing controls are grouped into compact toolbars, with clearer access to formatting and design panels.",
      "Switch between light and dark themes from the command menu",
      "Slides marked to skip are omitted from presentations, with correct slide numbers and totals",
      "## October 19, 2026",
      historicalBody,
    ].join("\n");

    const localized = localizeSlidesChangelog(markdown, {
      ...esMessages.slidesChangelog,
      editorHoveredObjects: "Editor note in this locale.",
      deckEditingControls: "Deck controls note in this locale.",
      googleSlidesMissingImageData: "Import note in this locale.",
      globalMediaPickerScope: "Media picker note in this locale.",
      presenterControls: "Presenter controls note in this locale.",
      presenterBuildStepPreview: "Presenter build preview note in this locale.",
      staleSlidePreviews: "Stale previews note in this locale.",
      boundedMediaTransfers: "Media transfer note in this locale.",
      editorCanvasAppTheme: "Editor canvas theme note in this locale.",
      editorInspectorTextControls: "Text inspector note in this locale.",
      savedSlideImages: "Saved slide images note in this locale.",
      keyboardObjectTransforms:
        "Keyboard object transform note in this locale.",
      editorToolbarInspector: "Toolbar and inspector note in this locale.",
      commandMenuTheme: "Command menu theme note in this locale.",
      skippedSlidePresentation: "Skipped slide note in this locale.",
    });

    expect(localized).toContain("Editor note in this locale.");
    expect(localized).toContain("Deck controls note in this locale.");
    expect(localized).toContain("Import note in this locale.");
    expect(localized).toContain("Media picker note in this locale.");
    expect(localized).toContain("Presenter controls note in this locale.");
    expect(localized).toContain("Presenter build preview note in this locale.");
    expect(localized).toContain("Stale previews note in this locale.");
    expect(localized).toContain("Media transfer note in this locale.");
    expect(localized).toContain("Editor canvas theme note in this locale.");
    expect(localized).toContain("Text inspector note in this locale.");
    expect(localized).toContain("Saved slide images note in this locale.");
    expect(localized).toContain("Toolbar and inspector note in this locale.");
    expect(localized).toContain("Command menu theme note in this locale.");
    expect(localized).toContain("Skipped slide note in this locale.");
    expect(localized).not.toContain("The editor highlights hovered objects");
    expect(localized).not.toContain("The slide-list toggle");
    expect(localized).not.toContain("Google Slides imports now report");
    expect(localized).not.toContain("Scope global media picks");
    expect(localized).not.toContain("Presenter controls use shared workspace");
    expect(localized).not.toContain(
      "The presenter console previews each remaining build step",
    );
    expect(localized).not.toContain("Stale slide previews clear");
    expect(localized).not.toContain("Document and slide media transfers stop");
    expect(localized).not.toContain("The slide editor keeps its canvas");
    expect(localized).not.toContain(
      "Style text with typography and color controls",
    );
    expect(localized).not.toContain("Images used by saved slides");
    expect(localized).not.toContain("Slide editing controls are grouped");
    expect(localized).not.toContain("Switch between light and dark themes");
    expect(localized).not.toContain("Slides marked to skip are omitted");
    expect(localized).toContain(historicalBody);
  });

  it("localizes every current dated note in Spanish and Portuguese", () => {
    const changelogUrl = new URL("../../changelog/", import.meta.url);
    const currentBodies = readdirSync(changelogUrl)
      .filter(
        (fileName) =>
          /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(fileName) &&
          fileName.slice(0, 10) >= "2026-10-20",
      )
      .sort()
      .map((fileName) =>
        readFileSync(new URL(fileName, changelogUrl), "utf8")
          .replace(/^---[\s\S]*?---\s*/, "")
          .trim(),
      );

    expect(currentBodies.length).toBeGreaterThan(0);
    const markdown = currentBodies.join("\n");

    for (const [locale, translations] of translatedChangelogCatalogs) {
      const localized = localizeSlidesChangelog(markdown, translations);

      for (const body of currentBodies) {
        expect(
          localized,
          `${locale} left a dated note untranslated`,
        ).not.toContain(body);
      }
    }
  });

  it("localizes build step bounds in every configured non-English locale", () => {
    const source =
      "Build step controls disable moves past the start and end of the reveal order.";

    for (const [locale, translations] of translatedChangelogCatalogs) {
      const localized = localizeSlidesChangelog(source, translations);

      expect(
        translations.presenterBuildStepBounds,
        `${locale} is missing the build step bounds translation`,
      ).not.toBe(source);
      expect(
        localized,
        `${locale} left the build step bounds note in English`,
      ).not.toContain(source);
      expect(localized).toBe(translations.presenterBuildStepBounds);
    }
  });

  it("localizes object comment attachment in every configured non-English locale", () => {
    const source = "Comments stay attached to slide objects when they move";

    for (const [locale, translations] of translatedChangelogCatalogs) {
      const localized = localizeSlidesChangelog(source, translations);

      expect(
        translations.objectCommentsStayAttached,
        `${locale} is missing the object comment attachment translation`,
      ).not.toBe(source);
      expect(
        localized,
        `${locale} left the object comment note in English`,
      ).toBe(translations.objectCommentsStayAttached);
    }
  });

  it("localizes the agent connection status in every configured locale", () => {
    const source = "The slide editor shows when the agent is connected.";

    for (const [locale, translations] of translatedChangelogCatalogs) {
      const localized = localizeSlidesChangelog(source, translations);

      expect(
        translations.agentConnectionStatus,
        `${locale} is missing the agent connection status translation`,
      ).not.toBe(source);
      expect(localized).toBe(translations.agentConnectionStatus);
    }
  });
});
