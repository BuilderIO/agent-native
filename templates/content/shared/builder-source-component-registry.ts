import type {
  SourceComponentEditState,
  SourceComponentMappingStatus,
} from "./source-component-block";

export type BuilderSourceComponentReadableMode =
  | "editable-markdown"
  | "source-component";

export interface BuilderSourceComponentMapping {
  id: string;
  componentNames: string[];
  readableMode: BuilderSourceComponentReadableMode;
  mappingStatus: SourceComponentMappingStatus;
  sourceEditState: SourceComponentEditState;
  label: string;
  reason: string;
}

function normalizeComponentName(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s:_-]+/g, "");
}

function componentNameTokens(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[\s:_-]+/g)
    .filter(Boolean);
}

export const builderSourceComponentMappings: BuilderSourceComponentMapping[] = [
  {
    id: "builder-text-markdown",
    componentNames: ["Text"],
    readableMode: "editable-markdown",
    mappingStatus: "mapped",
    sourceEditState: "safe-to-edit",
    label: "Builder Text",
    reason:
      "Text maps to editable Markdown while Builder metadata stays in the raw sidecar.",
  },
  {
    id: "builder-code-markdown",
    componentNames: ["Code Block", "Blog Code Block"],
    readableMode: "editable-markdown",
    mappingStatus: "mapped",
    sourceEditState: "safe-to-edit",
    label: "Builder Code Block",
    reason:
      "Code maps to editable fenced Markdown while Builder metadata stays in the raw sidecar.",
  },
  {
    id: "builder-image-markdown",
    componentNames: ["Image"],
    readableMode: "editable-markdown",
    mappingStatus: "mapped",
    sourceEditState: "safe-to-edit",
    label: "Builder Image",
    reason:
      "Images map to editable Markdown image syntax while Builder metadata stays in the raw sidecar.",
  },
  {
    id: "builder-tabbed-content-markdown",
    componentNames: ["Tabbed Content"],
    readableMode: "editable-markdown",
    mappingStatus: "mapped",
    sourceEditState: "safe-to-edit",
    label: "Builder Tabbed Content",
    reason:
      "Tabs map to editable heading-delimited Markdown while tab metadata stays in the raw sidecar.",
  },
  {
    id: "builder-symbol-preserved",
    componentNames: ["Symbol"],
    readableMode: "source-component",
    mappingStatus: "preserved",
    sourceEditState: "needs-review",
    label: "Builder Symbol",
    reason:
      "Symbols stay linked to their Builder entry and need a dedicated review path before retargeting.",
  },
  {
    id: "builder-table-preserved",
    componentNames: ["Table", "Material Table"],
    readableMode: "source-component",
    mappingStatus: "preserved",
    sourceEditState: "needs-review",
    label: "Builder Table",
    reason:
      "Builder table-like components preserve their raw source and expose a preview until an editable table mapper is configured.",
  },
  {
    id: "builder-reference-preserved",
    componentNames: [
      "Reference",
      "Reference Block",
      "Content Reference",
      "Builder Reference",
    ],
    readableMode: "source-component",
    mappingStatus: "preserved",
    sourceEditState: "needs-review",
    label: "Builder Reference",
    reason:
      "Reference blocks preserve their provider identity so they can round-trip without detaching the source relation.",
  },
  {
    id: "builder-embed-preserved",
    componentNames: ["Embed"],
    readableMode: "source-component",
    mappingStatus: "preserved",
    sourceEditState: "needs-review",
    label: "Builder Embed",
    reason:
      "Embeds preserve provider-native configuration and expose a preview instead of editable markup.",
  },
  {
    id: "builder-code-snippets-preserved",
    componentNames: ["CodeSnippetsV2"],
    readableMode: "source-component",
    mappingStatus: "preserved",
    sourceEditState: "needs-review",
    label: "Builder CodeSnippetsV2",
    reason:
      "CodeSnippetsV2 has structured Builder props and needs a dedicated mapper before safe readable editing.",
  },
];

const mappingsByName = new Map(
  builderSourceComponentMappings.flatMap((mapping) =>
    mapping.componentNames.map(
      (componentName) =>
        [normalizeComponentName(componentName), mapping] as const,
    ),
  ),
);

export function unknownBuilderSourceComponentMappingFor(
  componentName: string | null | undefined,
): BuilderSourceComponentMapping {
  return {
    id: componentName
      ? "builder-unknown-preserved"
      : "builder-nameless-preserved",
    componentNames: componentName ? [componentName] : [],
    readableMode: "source-component",
    mappingStatus: "unknown",
    sourceEditState: "preserved-only",
    label: componentName ? `Builder ${componentName}` : "Builder component",
    reason: componentName
      ? "No source-component mapper is registered for this Builder component yet, so Content preserves the raw block for review."
      : "Builder returned a block without a component name, so Content preserves the raw block for review.",
  };
}

export function builderSourceComponentMappingFor(
  componentName: string | null | undefined,
): BuilderSourceComponentMapping {
  const normalized = normalizeComponentName(componentName);
  const direct = mappingsByName.get(normalized);
  if (direct) return direct;
  const tokens = componentNameTokens(componentName);
  const tableMapping = mappingsByName.get("materialtable");
  if (tokens.includes("table") && tableMapping) {
    return tableMapping;
  }
  const referenceMapping = mappingsByName.get("reference");
  if (tokens.includes("reference") && referenceMapping) {
    return referenceMapping;
  }
  return unknownBuilderSourceComponentMappingFor(componentName);
}
