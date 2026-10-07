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
    "Create and refine interactive prototypes in the Agent-Native Design workspace. Inspect available templates and design systems, save a renderable design, and preserve unrelated screens when editing. This plugin does not connect to local repositories, deploy websites, or publish production changes.",
  toolDescriptions: {
    "get-design-snapshot":
      "Read a saved design and its selected file. Use the returned design-system context and locked-layer details to preserve the existing prototype when editing.",
    "create-design":
      "Create an empty design project. Follow it with generate-design to author and save a renderable screen before reporting the project as complete.",
    "present-design-variants":
      "Create two to five saved visual directions for a design request. Ask the user to choose one, then refine that screen with get-design-snapshot and edit-design. Keep the other directions saved unless the user asks to remove them.",
    "edit-design":
      "Edit one design file after reading its snapshot. Reuse the existing design-system tokens and preserve unrelated content.",
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
