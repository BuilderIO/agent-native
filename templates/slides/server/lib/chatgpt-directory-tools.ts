export const CHATGPT_DIRECTORY_TOOL_NAMES = [
  "list-decks",
  "get-deck",
  "list-design-systems",
  "get-design-system",
  "get-workspace-defaults",
  "get-deck-reference-context",
  "create-deck",
  "add-slide",
  "update-slide",
  "duplicate-deck",
];

export const CHATGPT_DIRECTORY_PROFILE = {
  connectorCatalog: CHATGPT_DIRECTORY_TOOL_NAMES,
  keyToolNames: [
    "list-decks",
    "get-deck",
    "create-deck",
    "add-slide",
    "update-slide",
  ],
  instructions:
    "Create editable presentations from briefs, follow returned design-system context, and preserve unrelated slide content when revising. Ask before replacing an existing deck. This plugin does not delete decks or edit PowerPoint or Google Slides files.",
  toolDescriptions: {
    "get-deck":
      "Read a presentation or selected slides. Use slideId for a focused read, or slideIds with compact=false to inspect full HTML and content hashes. Preserve source imports and unrelated slides when editing.",
    "create-deck":
      "Create an editable presentation from a brief. Pass all slides in one call when the deck is fully planned, or create an empty deck and add slides in order for a longer workflow. The saved deck opens in Agent-Native Slides.",
    "add-slide":
      "Append one fully styled slide to an existing presentation. Use this for new slides and use update-slide for one targeted edit. The result confirms the saved slide ID and position.",
    "update-slide":
      "Edit one slide while preserving unrelated content. Use the slide ID and content hash from get-deck when available, and prefer a bounded text or style edit over replacing the full HTML.",
    "duplicate-deck":
      "Create a separate editable copy of an existing presentation with a new title. The source deck remains unchanged.",
  },
  toolParameterDescriptions: {
    "get-deck": {
      deckId:
        "Deck ID. Alias of id, matching create-deck, add-slide, update-slide, and duplicate-deck.",
    },
    "update-slide": {
      baseContentHash:
        "Optional hash returned by get-deck for the exact slide source being edited. The edit is rejected if the source changed since it was read.",
    },
    "duplicate-deck": {
      newId: "Optional client-supplied ID for the new deck.",
    },
  },
  hiddenToolParameters: {
    "create-deck": ["generationAttemptId"],
  },
};
