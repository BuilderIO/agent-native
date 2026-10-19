import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";

export const CHATGPT_DIRECTORY_TOOL_NAMES = [
  "control-presenter",
  "list-decks",
  "get-deck",
  "get-slide-source",
  "list-design-systems",
  "get-design-system",
  "apply-design-system",
  "get-workspace-defaults",
  "get-deck-reference-context",
  "create-deck",
  "add-slide",
  "update-slide",
  "update-slide-source",
  "transform-slide-objects",
  "duplicate-deck",
];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function id(...values: unknown[]): string | null {
  return (
    values.find(
      (value): value is string =>
        typeof value === "string" && Boolean(value.trim()),
    ) ?? null
  );
}

// share-resource, unshare-resource, and set-resource-visibility assert admin
// access to the deck themselves, so an editor holds this grant without being
// able to change sharing.
const DECK_WIDGET_WRITE_ACTIONS = [
  "patch-deck",
  "share-resource",
  "unshare-resource",
  "set-resource-visibility",
] as const;

function deckWidgetTarget(deckId: string) {
  return {
    targetPath: `/deck/${encodeURIComponent(deckId)}`,
    resourceIds: { deckId, resourceType: "deck" },
    writeActions: DECK_WIDGET_WRITE_ACTIONS,
  };
}

type WidgetWriteAuthorizationInput = {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  target: { targetPath: string; resourceIds: Record<string, string> };
  identity: { userEmail?: string; orgId?: string | null };
};

export const CHATGPT_DIRECTORY_PROFILE = {
  connectorCatalog: CHATGPT_DIRECTORY_TOOL_NAMES,
  widgets: true,
  widgetDomain: "https://slides-2.agent-native.com",
  authorizeWidgetWrite: async ({
    target,
    identity,
  }: WidgetWriteAuthorizationInput) => {
    const deckId = target.resourceIds.deckId;
    const requestEmail = getRequestUserEmail()?.trim().toLowerCase();
    const requestOrgId = getRequestOrgId() ?? undefined;
    if (
      !deckId ||
      !identity.userEmail ||
      requestEmail !== identity.userEmail.trim().toLowerCase() ||
      (identity.orgId !== undefined &&
        (identity.orgId ?? undefined) !== requestOrgId)
    ) {
      return false;
    }
    try {
      await assertAccess("deck", deckId, "editor");
      return true;
    } catch (error) {
      if (error instanceof ForbiddenError) return false;
      throw error;
    }
  },
  widgetTargets: {
    "create-deck": (args: Record<string, unknown>, result: unknown) => {
      const deckId = id(record(result).id, args.deckId);
      return deckId ? deckWidgetTarget(deckId) : null;
    },
    "add-slide": (args: Record<string, unknown>, result: unknown) => {
      const deckId = id(args.deckId, record(result).deckId);
      return deckId ? deckWidgetTarget(deckId) : null;
    },
  },
  widgetReadActionArguments: {
    // The ticketed get-deck path normalizes duplicate IDs in memory only.
    "get-deck": { id: "deckId", deckId: "deckId" },
    "list-resource-shares": {
      resourceType: "resourceType",
      resourceId: "deckId",
    },
  },
  widgetWriteActionArguments: {
    "patch-deck": {
      deckId: "deckId",
      operations: { type: "actionSchema" as const },
      clientWrite: { type: "actionSchema" as const },
    },
    "share-resource": {
      resourceType: "resourceType",
      resourceId: "deckId",
      principalType: { type: "actionSchema" as const },
      principalId: { type: "actionSchema" as const },
      role: { type: "actionSchema" as const },
      notify: { type: "actionSchema" as const },
      resourceUrl: { type: "actionSchema" as const },
      message: { type: "actionSchema" as const },
    },
    "unshare-resource": {
      resourceType: "resourceType",
      resourceId: "deckId",
      principalType: { type: "actionSchema" as const },
      principalId: { type: "actionSchema" as const },
    },
    "set-resource-visibility": {
      resourceType: "resourceType",
      resourceId: "deckId",
      visibility: { type: "actionSchema" as const },
    },
  },
  widgetReadOnlyActions: ["get-deck"],
  widgetReadAuthenticatedActions: ["list-resource-shares"],
  keyToolNames: [
    "control-presenter",
    "list-decks",
    "get-deck",
    "create-deck",
    "add-slide",
    "update-slide",
    "get-slide-source",
    "update-slide-source",
    "transform-slide-objects",
    "apply-design-system",
    "duplicate-deck",
  ],
  instructions:
    "Agent-Native Slides 2 creates editable presentations from briefs, edits individual slides, and controls an open presenter console. Decks can include workspace design-system context. Replacing an existing deck requires confirmation. Deck deletion and editing PowerPoint or Google Slides files are outside this plugin's capabilities.",
  toolDescriptions: {
    "control-presenter":
      "Controls an open presentation by advancing, going back, jumping to a 1-based slide number, toggling a black or white blackout, or switching the presenter console to another deck. Switching requires viewer access to both decks.",
    "list-decks":
      "Lists accessible presentations with bounded metadata and optional previews. Full slide content is returned by get-deck.",
    "get-deck":
      "Reads an accessible presentation or selected slides and returns ordered summaries or full slide content, including content hashes, linked design-system context, and source-import coverage when present.",
    "get-slide-source":
      "Reads one saved slide's canonical React TSX source, revision, and SHA-256 source hash. Use it before editing a source-backed slide or resolving a revision conflict.",
    "list-design-systems":
      "Lists accessible design systems with their titles, IDs, and effective-default status.",
    "get-design-system":
      "Reads a design system by ID and returns colors, typography, spacing, assets, Builder references, and agent context. Compact mode returns a bounded summary; reference purpose marks style-only guidance.",
    "apply-design-system":
      "Links an accessible design system to an editable deck. Requires editor access to the deck and viewer access to the design system.",
    "get-workspace-defaults":
      "Reads workspace-wide brand defaults, including the reference deck and design system used for new decks when no selection is provided.",
    "get-deck-reference-context":
      "Extracts reusable visual-language context from a source deck, including linked design-system guidance and representative HTML layout examples. Source slide order is excluded.",
    "create-deck":
      "Creates an editable presentation from a brief and optional slide content. An omitted slide list creates an empty deck; an existing deck ID replaces that deck's slides. The result contains the saved presentation details.",
    "add-slide":
      "Appends one styled slide to an existing presentation and returns its saved slide ID and position. Generation metadata can identify intermediate and final writes.",
    "update-slide":
      "Updates one legacy/imported HTML slide by ID with an optional content hash. For a React source-backed slide, read get-slide-source and use update-slide-source with a unique source locator; reselect or clarify if the target is ambiguous.",
    "update-slide-source":
      "Atomically updates one source-backed slide using exactly one full React TSX replacement or a batch of source-located edits. Pass the revision and source hash from get-slide-source; a stale compare-and-swap is rejected without saving.",
    "transform-slide-objects":
      "Moves, resizes, rotates, aligns, distributes, groups, ungroups, or reorders selected source-backed objects using current view-screen locators and the revision and source hash from get-slide-source.",
    "duplicate-deck":
      "Creates a separately editable copy of an existing presentation with a new title. The source presentation remains unchanged.",
  },
  toolParameterDescriptions: {
    "control-presenter": {
      deckId: "ID of the currently open deck in the presenter console.",
      targetDeckId:
        "Target deck ID for switch-deck; viewer access to both the current and target decks is required.",
    },
    "get-deck": {
      deckId:
        "Deck ID. Alias of id, matching create-deck, add-slide, update-slide, and duplicate-deck.",
    },
    "apply-design-system": {
      deckId: "ID of the deck to update; editor access is required.",
      designSystemId:
        "ID of the design system to link; viewer access is required.",
    },
    "update-slide": {
      edits:
        "Ordered atomic edits against a legacy/imported HTML slide. expectedMatches=1 declares an exact replacement count, objectId targets an HTML element's inner content, and required=false permits a missing match. Source-backed React slides use get-slide-source and update-slide-source.",
      baseContentHash:
        "Optional HTML content hash returned by get-deck for the legacy/imported slide being edited. The edit is rejected if the slide changed since it was read.",
    },
    "get-slide-source": {
      deckId: "ID of the deck that contains the source-backed slide.",
      slideId:
        "Stable ID of the slide whose canonical React TSX source to read.",
    },
    "update-slide-source": {
      deckId: "ID of the deck that contains the source-backed slide.",
      slideId: "Stable ID of the source-backed slide to update.",
      expectedRevision:
        "Compare-and-swap revision returned by get-slide-source. The write is rejected if the current slide revision differs.",
      expectedSourceHash:
        "Compare-and-swap SHA-256 sourceHash returned by get-slide-source. Pass it with expectedRevision to ensure the source read is still current.",
      sourceTsx:
        "Complete replacement React TSX component source. Pass exactly one of sourceTsx or edits.",
      edits:
        "Atomic source-located edit operations. Pass exactly one of edits or sourceTsx; every edit must apply for the batch to save.",
    },
    "transform-slide-objects": {
      deckId: "ID of the deck containing the selected slide.",
      slideId: "ID of the selected source-backed slide.",
      expectedRevision:
        "Compare-and-swap revision returned by get-slide-source.",
      expectedSourceHash:
        "Compare-and-swap SHA-256 sourceHash returned by get-slide-source.",
      operation:
        "One atomic operation. Use source locators from the current view-screen selection; selected targets must share a JSX parent.",
    },
    "duplicate-deck": {
      slideIds:
        "Optional IDs for copied slides in source order. When provided, copied slides use these IDs so optimistic UI edits align with persisted slides.",
      newId: "Optional client-supplied ID for the new deck.",
    },
  },
  hiddenToolParameters: {
    "create-deck": ["generationAttemptId"],
  },
};
