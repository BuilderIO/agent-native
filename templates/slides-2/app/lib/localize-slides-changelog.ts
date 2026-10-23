export type SlidesChangelogTranslations = {
  editorHoveredObjects: string;
  deckEditingControls: string;
  googleSlidesMissingImageData: string;
  globalMediaPickerScope: string;
  presenterControls: string;
  presenterBuildStepPreview: string;
  presenterBuildStepBounds: string;
  staleSlidePreviews: string;
  boundedMediaTransfers: string;
  editorCanvasAppTheme: string;
  editorInspectorTextControls: string;
  savedSlideImages: string;
  keyboardObjectTransforms: string;
  editorToolbarInspector: string;
  commandMenuTheme: string;
  skippedSlidePresentation: string;
  browseDeckVersions: string;
  frameMissObjectSelection: string;
  commandMenuShortcut: string;
  crossDeckSlideCopy: string;
  completedSlideGeneration: string;
  deckTitleAndNotesLabel: string;
  deleteFocusedCanvasObject: string;
  deleteSelectedSlideObject: string;
  slideOverviewFromRail: string;
  presenterKeyboardNavigation: string;
  sourceBackedPdfExport: string;
  preserveDeckBriefOnRegeneration: string;
  jumpToSlideByNumber: string;
  mobileNavigationAndSlideChat: string;
  lightExtraBoldText: string;
  thumbnailArrowNavigation: string;
  homePromptDeckContinuity: string;
  slideTransitions: string;
  editorPanelWidthsAndRecovery: string;
  editorRailAndInspectorAlignment: string;
  chatEditPreviewVersion: string;
  objectCommentsStayAttached: string;
  agentTextSelectionStability: string;
  templateDeckChatPreviews: string;
  consistentSlideTextSpacing: string;
  renderFailuresCanvasMessage: string;
  editorPageCountFooter: string;
  presentButtonReferenceAccent: string;
  positionFieldsPreserveRotatedSize: string;
  selectedSlideArrowNavigation: string;
  chatPreviewStaleContent: string;
  deleteGlobalSlideImages: string;
  presenterSpaceActivation: string;
  presenterPageUpPageDown: string;
  presenterJumpCancellation: string;
  presenterBlankScreensAndNotes: string;
  restoreDeckVersionAgainstStaleEdits: string;
  singleSlideRevealPreview: string;
  agentConnectionStatus: string;
  svgPatternScaleRotation: string;
  sourceBackedClickAndPointer: string;
  commandMenuUndoRedoShortcuts: string;
  overlappingTextInlineEdit: string;
  presenterViewAlignment: string;
  softerSlideFrameShadow: string;
  presenterTouchNavigation: string;
  lightCanvasBorderedSurface: string;
  exactSlideTextFontSize: string;
  arrowKeysMoveSelectedObjects: string;
  redoKeyboardShortcuts: string;
  importImageDataAndPreviewSync: string;
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
    source: "Presenter controls use shared workspace buttons and inputs",
    key: "presenterControls",
  },
  {
    source:
      "The presenter console previews each remaining build step before moving to the next slide.",
    key: "presenterBuildStepPreview",
  },
  {
    source:
      "Build step controls disable moves past the start and end of the reveal order.",
    key: "presenterBuildStepBounds",
  },
  {
    source: "Stale slide previews clear before a different slide loads",
    key: "staleSlidePreviews",
  },
  {
    source:
      "Document and slide media transfers stop within safe size and time limits",
    key: "boundedMediaTransfers",
  },
  {
    source:
      "The slide editor follows your selected app theme across the canvas and selected-object controls.",
    key: "editorCanvasAppTheme",
  },
  {
    source:
      "Style text with typography and color controls, then edit it directly on the slide.",
    key: "editorInspectorTextControls",
  },
  {
    source: "Images used by saved slides stay available in your library.",
    key: "savedSlideImages",
  },
  {
    source: "Resize and rotate selected slide objects with the keyboard.",
    key: "keyboardObjectTransforms",
  },
  {
    source:
      "Slide editing controls are grouped into compact toolbars, with clearer access to formatting and design panels.",
    key: "editorToolbarInspector",
  },
  {
    source: "Switch between light and dark themes from the command menu",
    key: "commandMenuTheme",
  },
  {
    source:
      "Slides marked to skip are omitted from presentations, with correct slide numbers and totals",
    key: "skippedSlidePresentation",
  },
  {
    source:
      "Browse saved deck versions and restore a previous snapshot from the editor.",
    key: "browseDeckVersions",
  },
  {
    source:
      "Clicking slide objects selects them when the frame misses the direct target.",
    key: "frameMissObjectSelection",
  },
  {
    source: "Command-K opens the slide editor's command menu",
    key: "commandMenuShortcut",
  },
  {
    source:
      "Copy slides between decks, rename decks in the editor, and get warned before leaving with unsaved changes.",
    key: "crossDeckSlideCopy",
  },
  {
    source:
      "Deck generation waits for the requested number of completed slides before reporting success.",
    key: "completedSlideGeneration",
  },
  {
    source:
      "Long deck titles stay visible while editing, and the footer uses a shorter Notes label.",
    key: "deckTitleAndNotesLabel",
  },
  {
    source:
      "Delete and Backspace remove the selected canvas object when the canvas has focus.",
    key: "deleteFocusedCanvasObject",
  },
  {
    source:
      "Delete and Backspace remove the selected slide object from the canvas",
    key: "deleteSelectedSlideObject",
  },
  {
    source: "Open the slide overview directly from the slide rail.",
    key: "slideOverviewFromRail",
  },
  {
    source:
      "Presentations support Page Up, Page Down, Home, and End for keyboard slide navigation.",
    key: "presenterKeyboardNavigation",
  },
  {
    source: "Public deck pages can export source-backed slides to PDF",
    key: "sourceBackedPdfExport",
  },
  {
    source: "Slide regeneration keeps the original deck brief in context",
    key: "preserveDeckBriefOnRegeneration",
  },
  {
    source:
      "Jump to any presentation slide by typing its number, including multi-digit slide numbers.",
    key: "jumpToSlideByNumber",
  },
  {
    source:
      "Mobile navigation supports keyboard dismissal, and slide chat links follow the slide's current position",
    key: "mobileNavigationAndSlideChat",
  },
  {
    source:
      "Slide text can now use light and extra-bold weights for more precise typography.",
    key: "lightExtraBoldText",
  },
  {
    source: "Slide thumbnails now navigate with all four arrow keys.",
    key: "thumbnailArrowNavigation",
  },
  {
    source:
      "Slides generated from a home-screen prompt now stay in the deck you started.",
    key: "homePromptDeckContinuity",
  },
  {
    source:
      "Slides now support deck-wide and per-slide transitions, matched-object morphs, and step-by-step reveals.",
    key: "slideTransitions",
  },
  {
    source:
      "The editor header and panels now match the reference more closely, zoom and motion tools are in the command menu, and recovered decks no longer show stale errors.",
    key: "editorPanelWidthsAndRecovery",
  },
  {
    source:
      "The slide editor rail, canvas backdrop, toolbar, and inspector empty state now align more closely with the editing layout.",
    key: "editorRailAndInspectorAlignment",
  },
  {
    source:
      "Slide edit previews now match the exact version saved by the edit.",
    key: "chatEditPreviewVersion",
  },
  {
    source: "Comments stay attached to slide objects when they move",
    key: "objectCommentsStayAttached",
  },
  {
    source:
      "Agent text selections stay tied to saved slide content while edits are pending.",
    key: "agentTextSelectionStability",
  },
  {
    source:
      "Decks created from templates and updated decks show previews and actions in chat.",
    key: "templateDeckChatPreviews",
  },
  {
    source: "Slide text keeps consistent line spacing in the editor.",
    key: "consistentSlideTextSpacing",
  },
  {
    source:
      "Slides that fail to render now show a clear message on the canvas.",
    key: "renderFailuresCanvasMessage",
  },
  {
    source: "The editor shows the current page and total in the footer",
    key: "editorPageCountFooter",
  },
  {
    source:
      "The Present button now matches the slide editor's reference accent color",
    key: "presentButtonReferenceAccent",
  },
  {
    source: "Position fields preserve an object's size after rotation",
    key: "positionFieldsPreserveRotatedSize",
  },
  {
    source:
      "Arrow keys move selected slide objects by 1 px, or 10 px with Shift; without a selection, they navigate slides.",
    key: "selectedSlideArrowNavigation",
  },
  {
    source:
      "Chat previews no longer show slide content that changed after the result.",
    key: "chatPreviewStaleContent",
  },
  {
    source:
      "Delete unused images from the global asset collection in the slide editor.",
    key: "deleteGlobalSlideImages",
  },
  {
    source:
      "Focused presenter buttons now use Space to activate the selected control instead of advancing the deck.",
    key: "presenterSpaceActivation",
  },
  {
    source: "Page Up and Page Down can now navigate the presenter window",
    key: "presenterPageUpPageDown",
  },
  {
    source:
      "Presenter navigation cancels pending slide-number jumps so they cannot override a later choice.",
    key: "presenterJumpCancellation",
  },
  {
    source:
      "Presenter screens can be blanked in black or white, and speaker notes can be resized.",
    key: "presenterBlankScreensAndNotes",
  },
  {
    source:
      "Restoring a previous deck version now protects it from older slide edits.",
    key: "restoreDeckVersionAgainstStaleEdits",
  },
  {
    source:
      "Single-slide preview links can open a generated slide at a specific reveal step.",
    key: "singleSlideRevealPreview",
  },
  {
    source: "The slide editor shows when the agent is connected.",
    key: "agentConnectionStatus",
  },
  {
    source: "SVG pattern fills preserve their scale and rotation",
    key: "svgPatternScaleRotation",
  },
  {
    source:
      "Clicks and pointer movement now work on source-backed presentations",
    key: "sourceBackedClickAndPointer",
  },
  {
    source:
      "The slide editor command menu shows the keyboard shortcuts for undo and redo.",
    key: "commandMenuUndoRedoShortcuts",
  },
  {
    source:
      "Double-clicking text now opens inline editing when slide artwork overlaps it.",
    key: "overlappingTextInlineEdit",
  },
  {
    source:
      "Presenter mode lines up the current slide, next slide, speaker notes, and jump control in one view.",
    key: "presenterViewAlignment",
  },
  {
    source: "Slide canvases now use a softer frame shadow",
    key: "softerSlideFrameShadow",
  },
  {
    source: "Swipe left or right to move between slides while presenting",
    key: "presenterTouchNavigation",
  },
  {
    source: "The slide canvas now matches the light editor’s bordered surface.",
    key: "lightCanvasBorderedSurface",
  },
  {
    source: "You can type an exact font size while editing slide text.",
    key: "exactSlideTextFontSize",
  },
  {
    source: "Arrow keys move all selected slide objects together",
    key: "arrowKeysMoveSelectedObjects",
  },
  {
    source: "Redo uses Shift+Command+Z or Ctrl+Y",
    key: "redoKeyboardShortcuts",
  },
  {
    source:
      "PowerPoint and Google Docs imports now handle large image data more safely, and generated previews stay in sync when decks change.",
    key: "importImageDataAndPreviewSync",
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
