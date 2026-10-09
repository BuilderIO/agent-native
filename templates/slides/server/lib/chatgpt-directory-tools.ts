import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";

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
  widgetDomain: "https://slides.agent-native.com",
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
    "list-decks",
    "get-deck",
    "create-deck",
    "add-slide",
    "update-slide",
  ],
  instructions:
    "Agent-Native Slides creates editable presentations from briefs and edits individual slides. Decks can include workspace design-system context. Replacing an existing deck requires confirmation. Deck deletion and editing PowerPoint or Google Slides files are outside this plugin's capabilities.",
  toolDescriptions: {
    "list-decks":
      "Lists accessible presentations with bounded metadata and optional previews. Full slide content is returned by get-deck.",
    "get-deck":
      "Reads an accessible presentation or selected slides and returns ordered summaries or full slide content, including content hashes, linked design-system context, and source-import coverage when present.",
    "list-design-systems":
      "Lists accessible design systems with their titles, IDs, and effective-default status.",
    "get-design-system":
      "Reads a design system by ID and returns colors, typography, spacing, assets, Builder references, and agent context. Compact mode returns a bounded summary; reference purpose marks style-only guidance.",
    "get-workspace-defaults":
      "Reads workspace-wide brand defaults, including the reference deck and design system used for new decks when no selection is provided.",
    "get-deck-reference-context":
      "Extracts reusable visual-language context from a source deck, including linked design-system guidance and representative HTML layout examples. Source slide order is excluded.",
    "create-deck":
      "Creates an editable presentation from a brief and optional slide content. An omitted slide list creates an empty deck; an existing deck ID replaces that deck's slides. The result contains the saved presentation details.",
    "add-slide":
      "Appends one styled slide to an existing presentation and returns its saved slide ID and position. Generation metadata can identify intermediate and final writes.",
    "update-slide":
      "Updates one existing slide by ID with an optional source content hash. The operation targets that slide and preserves unrelated presentation content.",
    "duplicate-deck":
      "Creates a separately editable copy of an existing presentation with a new title. The source presentation remains unchanged.",
  },
  toolParameterDescriptions: {
    "get-deck": {
      deckId:
        "Deck ID. Alias of id, matching create-deck, add-slide, update-slide, and duplicate-deck.",
    },
    "update-slide": {
      edits:
        "Ordered atomic edits against current HTML. expectedMatches=1 declares an exact replacement count, objectId targets an element's inner content, and required=false permits a missing match.",
      baseContentHash:
        "Optional hash returned by get-deck for the exact slide source being edited. The edit is rejected if the source changed since it was read.",
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
