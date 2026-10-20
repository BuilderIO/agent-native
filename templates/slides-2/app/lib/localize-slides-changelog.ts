export type SlidesChangelogTranslations = {
  editorHoveredObjects: string;
  deckEditingControls: string;
  googleSlidesMissingImageData: string;
  globalMediaPickerScope: string;
  savedSlideImages: string;
};

const localizedBodies = [
  {
    source:
      "The editor highlights hovered objects and keeps image replace and crop actions on the canvas.",
    key: "editorHoveredObjects",
  },
  {
    source:
      "The slide-list toggle, deck title, and Present button now match the shared workspace controls.",
    key: "deckEditingControls",
  },
  {
    source:
      "Google Slides imports now report missing image data instead of adding empty images.",
    key: "googleSlidesMissingImageData",
  },
  {
    source: "Scope global media picks to assets the current deck can resolve.",
    key: "globalMediaPickerScope",
  },
  {
    source: "Images used by saved slides stay available in your library.",
    key: "savedSlideImages",
  },
] as const satisfies ReadonlyArray<{
  source: string;
  key: keyof SlidesChangelogTranslations;
}>;

export function localizeSlidesChangelog(
  markdown: string,
  translations: SlidesChangelogTranslations,
): string {
  return localizedBodies.reduce(
    (localized, { source, key }) =>
      localized.replace(source, translations[key]),
    markdown,
  );
}
