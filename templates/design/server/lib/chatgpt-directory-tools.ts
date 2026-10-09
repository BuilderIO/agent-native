export const CHATGPT_DIRECTORY_TOOL_NAMES = [
  "list-designs",
  "list-design-templates",
  "list-design-systems",
  "get-design-system",
  "get-design-snapshot",
  "create-design",
  "create-design-from-template",
  "generate-design",
  "present-design-variants",
  "edit-design",
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

function generatedScreenId(designId: string, result: unknown): string | null {
  const urlPath = record(result).urlPath;
  if (typeof urlPath !== "string") return null;
  const queryStart = urlPath.indexOf("?");
  const pathname = queryStart < 0 ? urlPath : urlPath.slice(0, queryStart);
  if (pathname !== `/design/${encodeURIComponent(designId)}`) return null;
  const query = queryStart < 0 ? "" : urlPath.slice(queryStart + 1);
  return id(new URLSearchParams(query.split("#", 1)[0]).get("screen"));
}

export const CHATGPT_DIRECTORY_PROFILE = {
  connectorCatalog: CHATGPT_DIRECTORY_TOOL_NAMES,
  widgets: true,
  widgetDomain: "https://design.agent-native.com",
  widgetTargets: {
    "create-design": (_args: Record<string, unknown>, result: unknown) => {
      const designId = id(record(result).id, record(result).designId);
      return designId
        ? {
            targetPath: `/design/${encodeURIComponent(designId)}`,
            resourceIds: { designId },
            writeActions: ["create-file", "update-design", "update-file"],
          }
        : null;
    },
    "create-design-from-template": (
      args: Record<string, unknown>,
      result: unknown,
    ) => {
      const designId = id(
        record(result).id,
        record(result).designId,
        args.targetDesignId,
      );
      return designId
        ? {
            targetPath: `/design/${encodeURIComponent(designId)}`,
            resourceIds: { designId },
            writeActions: ["create-file", "update-design", "update-file"],
          }
        : null;
    },
    "generate-design": (args: Record<string, unknown>, result: unknown) => {
      const designId = id(args.designId, record(result).designId);
      const screenId = designId ? generatedScreenId(designId, result) : null;
      return designId
        ? {
            targetPath: `/design/${encodeURIComponent(designId)}${
              screenId
                ? `?editorView=overview&screen=${encodeURIComponent(screenId)}`
                : ""
            }`,
            resourceIds: { designId },
            writeActions: ["create-file", "update-design", "update-file"],
          }
        : null;
    },
    "present-design-variants": (
      args: Record<string, unknown>,
      result: unknown,
    ) => {
      const designId = id(args.designId, record(result).designId);
      return designId
        ? {
            targetPath: `/design/${encodeURIComponent(designId)}`,
            resourceIds: { designId },
            writeActions: ["create-file", "update-design", "update-file"],
          }
        : null;
    },
  },
  widgetReadActionArguments: {
    "get-design-snapshot": { designId: "designId" },
    "get-design": { id: "designId" },
  },
  widgetWriteActionArguments: {
    "create-file": {
      designId: {
        type: "actionSchemaResourceBound" as const,
        resourceKey: "designId",
      },
      filename: { type: "actionSchema" as const },
      content: { type: "actionSchema" as const },
      fileType: { type: "actionSchema" as const },
    },
    "update-design": {
      id: "designId",
      title: { type: "actionSchema" as const },
      dataOperations: { type: "actionSchema" as const },
      operationSource: { type: "actionSchema" as const },
      operationRevision: { type: "actionSchema" as const },
    },
    "update-file": {
      id: {
        type: "actionSchemaResourceBound" as const,
        resourceKey: "designId",
      },
      content: { type: "actionSchema" as const },
      syncCollab: { type: "actionSchema" as const },
      identityOnly: { type: "actionSchema" as const },
      expectedVersionHash: { type: "actionSchema" as const },
      operationSource: { type: "actionSchema" as const },
      operationRevision: { type: "actionSchema" as const },
    },
  },
  widgetReadPublicActions: ["get-design"],
  keyToolNames: [
    "list-designs",
    "list-design-templates",
    "create-design",
    "generate-design",
    "present-design-variants",
    "edit-design",
  ],
  instructions:
    "Agent-Native Design stores interactive prototypes in a design workspace. Projects can be created, populated from templates, generated, and edited. A project without a saved screen is empty. Local repository changes, website deployment, and production publishing are outside this plugin's capabilities.",
  toolDescriptions: {
    "list-designs":
      "Lists accessible design projects with bounded pagination and optional HTML previews.",
    "list-design-templates":
      "Lists reusable templates available to the current user, including built-in and publicly discoverable templates. Optional previews include template assets.",
    "list-design-systems":
      "Lists accessible design systems with their titles, IDs, and default status.",
    "get-design-system":
      "Reads a design system by ID and returns colors, typography, spacing, assets, linked Builder documentation, and agent context. Compact mode returns a bounded summary.",
    "get-design-snapshot":
      "Reads a saved design and selected file, including file content, revision, linked design-system context, and locked-layer details.",
    "create-design":
      "Creates an empty design project. A newly created project has no screen until generated or copied content is saved.",
    "create-design-from-template":
      "Creates an editable design by copying a reusable template's files, dimensions, defaults, and locked layers. The result includes linked design-system context when it is readable.",
    "generate-design":
      "Saves generated design files to a design project. The result contains the saved files and design path; matching existing filenames can be updated.",
    "present-design-variants":
      "Creates two to five saved visual directions as screens on the Design overview board. The result contains the variant identifiers and saved screens.",
    "edit-design":
      "Edits one design file using its snapshot revision and preserves unrelated files. Search-and-replace and full-file replacement are supported edit modes.",
  },
  toolParameterDescriptions: {
    "generate-design": {
      canvasFrames:
        "Optional overview-canvas placements keyed by filename or file ID, each with numeric x, y, width, and height values.",
      devices:
        "Responsive device frames for the design. Omitted values default to desktop and mobile; an empty list creates one exact-size static screen. Exact canvas sizes are handled one per call, and wider devices become the base frame.",
      primaryViewport:
        "Primary form factor for the design. Defaults to desktop at 1440x900 and has no effect when devices is provided.",
    },
    "create-design-from-template": {
      targetDesignId:
        "Optional existing design ID to receive the copied template. Target designs are accepted only when they contain no files; existing content is not overwritten.",
    },
    "present-design-variants": {
      deleteSupersededSetIds:
        "Optional IDs of prior variant sets created by this caller whose screens have never been selected, kept, or discussed. Omitted IDs leave prior sets unchanged.",
      responsive:
        "Whether generated directions contain responsive breakpoint frames. Defaults to true; exact pixel dimensions in the prompt suppress extra device frames.",
    },
  },
};
