import { NodeOperationError, type INode, type INodeProperties, type INodeTypeDescription } from "n8n-workflow";

const ACTIONS = "/_agent-native/actions";
const VALIDATION_NODE = { name: "agentNativeSlides" } as INode;

export type DeckPayload = {
  title: string;
  slides: Array<{ id: string; content: string; layout?: string; notes?: string }>;
  [key: string]: unknown;
};

export function validateSaveDeckPayload(payload: unknown): asserts payload is DeckPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new NodeOperationError(VALIDATION_NODE, "Deck JSON must be an object.");
  }
  const deck = payload as Record<string, unknown>;
  if (typeof deck.title !== "string" || !deck.title.trim()) {
    throw new NodeOperationError(VALIDATION_NODE, "Deck title is required.");
  }
  if (/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z0-9_-]{12,64}$/.test(deck.title.trim())) {
    throw new NodeOperationError(VALIDATION_NODE, "Deck title must be descriptive and human-readable.");
  }
  if (!Array.isArray(deck.slides)) {
    throw new NodeOperationError(VALIDATION_NODE, "Deck slides must be an array.");
  }
  for (const slide of deck.slides) {
    if (!slide || typeof slide !== "object" || Array.isArray(slide)) {
      throw new NodeOperationError(VALIDATION_NODE, "Each slide must be an object.");
    }
    const value = slide as Record<string, unknown>;
    if (typeof value.id !== "string" || !value.id || typeof value.content !== "string") {
      throw new NodeOperationError(VALIDATION_NODE, "Each slide requires an existing id and HTML content.");
    }
  }
}

const deckResource: INodeProperties = {
  displayName: "Resource",
  name: "resource",
  type: "options",
  noDataExpression: true,
  options: [
    { name: "Deck", value: "deck" },
    { name: "Comment", value: "comment" },
  ],
  default: "deck",
};

const deckOperation: INodeProperties = {
  displayName: "Operation",
  name: "operation",
  type: "options",
  noDataExpression: true,
  displayOptions: { show: { resource: ["deck"] } },
  options: [
    { name: "Create", value: "create", action: "Create a deck" },
    { name: "Delete", value: "delete", action: "Delete a deck" },
    { name: "Duplicate", value: "duplicate", action: "Duplicate a deck" },
    { name: "Export HTML", value: "exportHtml", action: "Export a deck as HTML" },
    { name: "Export PPTX", value: "exportPptx", action: "Export a deck as PPTX" },
    { name: "Get", value: "get", action: "Get a deck" },
    { name: "Get Many", value: "getMany", action: "Get many decks" },
    { name: "Get Versions", value: "getVersions", action: "Get deck versions" },
    { name: "Restore Version", value: "restoreVersion", action: "Restore a deck version" },
  ],
  default: "create",
};

const commentOperation: INodeProperties = {
  displayName: "Operation",
  name: "operation",
  type: "options",
  noDataExpression: true,
  displayOptions: { show: { resource: ["comment"] } },
  options: [
    { name: "Create", value: "create", action: "Create a comment" },
    { name: "Delete", value: "delete", action: "Delete a comment" },
    { name: "Get Many", value: "getMany", action: "Get many comments" },
    { name: "Update", value: "update", action: "Update a comment" },
  ],
  default: "create",
};

const deckId = (operations: string[]): INodeProperties => ({
  displayName: "Deck ID",
  name: "deckId",
  type: "string",
  default: "",
  required: true,
  displayOptions: { show: { resource: ["deck"], operation: operations } },
});

const commentDeckId = (operations: string[]): INodeProperties => ({
  displayName: "Deck ID",
  name: "deckId",
  type: "string",
  default: "",
  required: true,
  displayOptions: { show: { resource: ["comment"], operation: operations } },
});

export class AgentNativeSlides {
  description: INodeTypeDescription = {
    displayName: "Agent-Native Slides",
    name: "agentNativeSlides",
    icon: "file:agent-native-slides.svg",
    group: ["transform"],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: "Create, manage, export, and comment on Agent-Native Slides decks",
    defaults: { name: "Agent-Native Slides" },
    inputs: ["main"],
    outputs: ["main"],
    usableAsTool: true,
    credentials: [{ name: "agentNativeSlidesApi", required: true }],
    requestDefaults: {
      baseURL: "={{$credentials.baseUrl}}",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
    },
    properties: [
      deckResource,
      deckOperation,
      commentOperation,
      {
        displayName: "Deck ID",
        name: "deckId",
        type: "string",
        default: "",
        displayOptions: { show: { resource: ["deck"], operation: ["create"] } },
        description: "Optional. When set, this replaces that deck through save-deck with the full payload.",
      },
      {
        displayName: "Title",
        name: "title",
        type: "string",
        default: "",
        required: true,
        displayOptions: { show: { resource: ["deck"], operation: ["create"] } },
        description: "Descriptive title. Empty and opaque ID-like titles are rejected by Agent-Native Slides.",
      },
      {
        displayName: "Slides",
        name: "slides",
        type: "fixedCollection",
        typeOptions: { multipleValues: true },
        default: {},
        displayOptions: { show: { resource: ["deck"], operation: ["create"], rawDeck: [false] } },
        options: [{
          name: "slide",
          displayName: "Slide",
          values: [
            { displayName: "Slide ID", name: "id", type: "string", default: "", required: true, description: "Provide an existing stable slide ID. This node never generates IDs." },
            { displayName: "HTML Content", name: "content", type: "string", typeOptions: { rows: 5 }, default: "", required: true },
            { displayName: "Layout", name: "layout", type: "options", options: ["title", "section", "content", "two-column", "image", "statement", "full-image", "blank"].map((value) => ({ name: value, value })), default: "" },
            { displayName: "Speaker Notes", name: "notes", type: "string", typeOptions: { rows: 3 }, default: "" },
          ],
        }],
      },
      {
        displayName: "Raw Deck JSON",
        name: "rawDeck",
        type: "string",
        typeOptions: { rows: 8 },
        default: "",
        displayOptions: { show: { resource: ["deck"], operation: ["create"] } },
        description: "Optional full deck payload override. It must include a descriptive title and slides with existing IDs.",
      },
      deckId(["delete", "duplicate", "exportPptx", "exportHtml", "get", "getVersions", "restoreVersion"]),
      {
        displayName: "New Title",
        name: "duplicateTitle",
        type: "string",
        default: "",
        displayOptions: { show: { resource: ["deck"], operation: ["duplicate"] } },
      },
      {
        displayName: "Include Speaker Notes",
        name: "includeNotes",
        type: "boolean",
        default: true,
        displayOptions: { show: { resource: ["deck"], operation: ["exportPptx"] } },
      },
      {
        displayName: "Download File",
        name: "downloadFile",
        type: "boolean",
        default: true,
        displayOptions: { show: { resource: ["deck"], operation: ["exportPptx", "exportHtml"] } },
        description: "Whether to download the short-lived unauthenticated artifact URL into n8n binary data",
      },
      {
        displayName: "Return All",
        name: "returnAll",
        type: "boolean",
        default: false,
        description: "Whether to return all results or only up to a given limit",
        displayOptions: { show: { resource: ["deck"], operation: ["getMany"] } },
      },
      {
        displayName: "Limit",
        name: "limit",
        type: "number",
        typeOptions: { minValue: 1 },
        default: 50,
        description: "Max number of results to return",
        displayOptions: { show: { resource: ["deck"], operation: ["getMany"], returnAll: [false] } },
      },
      {
        displayName: "Updated Since",
        name: "updatedSince",
        type: "dateTime",
        default: "",
        displayOptions: { show: { resource: ["deck"], operation: ["getMany"] } },
      },
      {
        displayName: "Version ID",
        name: "versionId",
        type: "string",
        default: "",
        required: true,
        displayOptions: { show: { resource: ["deck"], operation: ["restoreVersion"] } },
      },
      commentDeckId(["create", "getMany"]),
      {
        displayName: "Slide ID",
        name: "slideId",
        type: "string",
        default: "",
        required: true,
        displayOptions: { show: { resource: ["comment"], operation: ["create", "getMany"] } },
      },
      {
        displayName: "Comment ID",
        name: "commentId",
        type: "string",
        default: "",
        required: true,
        displayOptions: { show: { resource: ["comment"], operation: ["delete", "update"] } },
      },
      {
        displayName: "Comment",
        name: "content",
        type: "string",
        typeOptions: { rows: 4 },
        default: "",
        required: true,
        displayOptions: { show: { resource: ["comment"], operation: ["create", "update"] } },
      },
      {
        displayName: "Quoted Text",
        name: "quotedText",
        type: "string",
        default: "",
        displayOptions: { show: { resource: ["comment"], operation: ["create"] } },
      },
      {
        displayName: "Thread ID",
        name: "threadId",
        type: "string",
        default: "",
        displayOptions: { show: { resource: ["comment"], operation: ["create"] } },
      },
      {
        displayName: "Parent Comment ID",
        name: "parentId",
        type: "string",
        default: "",
        displayOptions: { show: { resource: ["comment"], operation: ["create"] } },
      },
      {
        displayName: "Resolved",
        name: "resolved",
        type: "boolean",
        default: false,
        displayOptions: { show: { resource: ["comment"], operation: ["update"] } },
      },
      {
        displayName: "Deck Create or Save Routing",
        name: "createRouting",
        type: "hidden",
        default: "",
        routing: {
          request: {
            method: "={{ $parameter.deckId ? 'PUT' : 'POST' }}" as never,
            url: `={{ $parameter.deckId ? '${ACTIONS}/save-deck' : '${ACTIONS}/create-deck' }}`,
            body: "={{ (() => { const raw = $parameter.rawDeck; const deck = raw ? JSON.parse(raw) : { title: $parameter.title, slides: $parameter.slides.slide || [] }; if ($parameter.deckId) return { deckId: $parameter.deckId, deck }; return deck; })() }}" as never,
          },
        },
        displayOptions: { show: { resource: ["deck"], operation: ["create"] } },
      },
      {
        displayName: "Deck Action Routing",
        name: "deckActionRouting",
        type: "hidden",
        default: "",
        routing: {
          request: {
            method: "={{ ({ delete: 'DELETE', duplicate: 'POST', exportPptx: 'POST', exportHtml: 'POST', get: 'GET', getMany: 'GET', getVersions: 'GET', restoreVersion: 'POST' })[$parameter.operation] }}" as never,
            url: `={{ ({ delete: '${ACTIONS}/delete-deck', duplicate: '${ACTIONS}/duplicate-deck', exportPptx: '${ACTIONS}/export-pptx', exportHtml: '${ACTIONS}/export-html', get: '${ACTIONS}/get-deck', getMany: '${ACTIONS}/list-decks', getVersions: '${ACTIONS}/list-deck-versions', restoreVersion: '${ACTIONS}/restore-deck-version' })[$parameter.operation] }}`,
            qs: "={{ $parameter.operation === 'getMany' ? { limit: $parameter.returnAll ? 100 : $parameter.limit, updatedSince: $parameter.updatedSince || undefined } : $parameter.operation === 'get' ? { id: $parameter.deckId } : $parameter.operation === 'getVersions' ? { deckId: $parameter.deckId } : {} }}" as never,
            body: "={{ $parameter.operation === 'delete' ? { id: $parameter.deckId } : $parameter.operation === 'duplicate' ? { deckId: $parameter.deckId, title: $parameter.duplicateTitle || null } : $parameter.operation === 'exportPptx' ? { deckId: $parameter.deckId, includeNotes: $parameter.includeNotes } : $parameter.operation === 'exportHtml' ? { deckId: $parameter.deckId } : $parameter.operation === 'restoreVersion' ? { deckId: $parameter.deckId, versionId: $parameter.versionId } : {} }}" as never,
          },
        },
        displayOptions: { show: { resource: ["deck"], operation: ["delete", "duplicate", "exportPptx", "exportHtml", "get", "getMany", "getVersions", "restoreVersion"] } },
      },
      {
        displayName: "Comment Action Routing",
        name: "commentActionRouting",
        type: "hidden",
        default: "",
        routing: {
          request: {
            method: "={{ ({ create: 'POST', delete: 'DELETE', getMany: 'GET', update: 'POST' })[$parameter.operation] }}" as never,
            url: `={{ ({ create: '${ACTIONS}/add-slide-comment', delete: '${ACTIONS}/delete-slide-comment', getMany: '${ACTIONS}/list-slide-comments', update: '${ACTIONS}/update-slide-comment' })[$parameter.operation] }}`,
            qs: "={{ $parameter.operation === 'getMany' ? { deckId: $parameter.deckId, slideId: $parameter.slideId } : {} }}" as never,
            body: "={{ $parameter.operation === 'create' ? { deckId: $parameter.deckId, slideId: $parameter.slideId, content: $parameter.content, quotedText: $parameter.quotedText || undefined, threadId: $parameter.threadId || undefined, parentId: $parameter.parentId || undefined } : $parameter.operation === 'delete' ? { id: $parameter.commentId } : { id: $parameter.commentId, content: $parameter.content, resolved: $parameter.resolved } }}" as never,
          },
        },
        displayOptions: { show: { resource: ["comment"], operation: ["create", "delete", "getMany", "update"] } },
      },
    ],
  };
}
