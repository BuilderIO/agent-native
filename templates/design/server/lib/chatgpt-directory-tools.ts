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

export const CHATGPT_DIRECTORY_PROFILE = {
  connectorCatalog: CHATGPT_DIRECTORY_TOOL_NAMES,
  widgets: true,
  widgetDomain: "https://design.agent-native.com",
  widgetTargets: {
    "get-design-snapshot": (args: Record<string, unknown>, result: unknown) => {
      const designId = id(args.designId, record(result).designId);
      return designId
        ? {
            targetPath: `/design/${encodeURIComponent(designId)}`,
            resourceIds: { designId },
          }
        : null;
    },
    "create-design": (_args: Record<string, unknown>, result: unknown) => {
      const designId = id(record(result).id, record(result).designId);
      return designId
        ? {
            targetPath: `/design/${encodeURIComponent(designId)}`,
            resourceIds: { designId },
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
          }
        : null;
    },
    "generate-design": (args: Record<string, unknown>, result: unknown) => {
      const designId = id(args.designId, record(result).designId);
      return designId
        ? {
            targetPath: `/design/${encodeURIComponent(designId)}`,
            resourceIds: { designId },
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
          }
        : null;
    },
  },
  widgetReadActionArguments: {
    "get-design-snapshot": { designId: "designId" },
    "get-design": { id: "designId" },
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
        "Optional overview-canvas placements for saved screens. Reference each screen by filename or file ID and provide its x, y, width, and height.",
    },
    "present-design-variants": {
      deleteSupersededSetIds:
        "Optional IDs of earlier variant sets to remove when the user asks for a completely different set. Include only sets you created whose screens the user has never picked, kept, or discussed; otherwise omit.",
    },
  },
};
