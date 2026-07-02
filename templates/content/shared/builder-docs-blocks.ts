import {
  defineBlock,
  markdown,
  type BlockMdxConfig,
  type BlockSpec,
} from "@agent-native/core/blocks/server";
import { z } from "zod";

export const BUILDER_DOCS_MDX_SOURCE_MODE = "builder-mdx";
export const BUILDER_DOCS_SOURCE_KIND_PREFIX = "builder-cms:";

export interface BuilderRawRefData {
  rawRef: string;
  rawHash: string;
  componentName?: string;
}

export interface BuilderTextData extends BuilderRawRefData {
  body: string;
}

export interface BuilderCodeBlockData extends BuilderRawRefData {
  code: string;
  language?: string;
  filename?: string;
  dark?: boolean;
  url?: string;
}

export interface BuilderCodeSnippetsV2Data extends BuilderRawRefData {
  modelName?: string;
  modelType?: string;
  customTabContent?: Record<string, unknown>;
  reuseRemixContentForHydrogen?: boolean;
  convenientEditingMode?: boolean;
  simple?: boolean;
}

export interface BuilderTabbedContentTab {
  label: string;
  body: string;
}

export interface BuilderTabbedContentData extends BuilderRawRefData {
  title?: string;
  tabs: BuilderTabbedContentTab[];
}

export interface BuilderSymbolData extends BuilderRawRefData {
  entry?: string;
  model?: string;
  source?: string;
  dynamic?: boolean;
  data?: Record<string, unknown>;
}

export interface BuilderRawBlockData extends BuilderRawRefData {
  summary?: string;
}

const rawRefSchema = {
  rawRef: z.string().trim().min(1),
  rawHash: z.string().trim().min(1),
  componentName: z.string().trim().max(120).optional(),
};

export const builderTextSchema = z.object({
  ...rawRefSchema,
  body: markdown(z.string().max(100_000)) as z.ZodType<string>,
}) as unknown as z.ZodType<BuilderTextData>;

export const builderCodeBlockSchema = z.object({
  ...rawRefSchema,
  code: z.string().max(200_000),
  language: z.string().trim().max(80).optional(),
  filename: z.string().trim().max(400).optional(),
  dark: z.boolean().optional(),
  url: z.string().trim().max(2_000).optional(),
}) as unknown as z.ZodType<BuilderCodeBlockData>;

export const builderCodeSnippetsV2Schema = z.object({
  ...rawRefSchema,
  modelName: z.string().trim().max(120).optional(),
  modelType: z.string().trim().max(40).optional(),
  customTabContent: z.record(z.string(), z.unknown()).optional(),
  reuseRemixContentForHydrogen: z.boolean().optional(),
  convenientEditingMode: z.boolean().optional(),
  simple: z.boolean().optional(),
}) as unknown as z.ZodType<BuilderCodeSnippetsV2Data>;

export const builderTabbedContentSchema = z.object({
  ...rawRefSchema,
  title: z.string().trim().max(200).optional(),
  tabs: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(120),
        body: markdown(z.string().max(100_000)) as z.ZodType<string>,
      }),
    )
    .min(1)
    .max(20),
}) as unknown as z.ZodType<BuilderTabbedContentData>;

export const builderSymbolSchema = z.object({
  ...rawRefSchema,
  entry: z.string().trim().max(240).optional(),
  model: z.string().trim().max(120).optional(),
  source: z.string().trim().max(2_000).optional(),
  dynamic: z.boolean().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
}) as unknown as z.ZodType<BuilderSymbolData>;

export const builderRawBlockSchema = z.object({
  ...rawRefSchema,
  summary: z.string().trim().max(500).optional(),
}) as unknown as z.ZodType<BuilderRawBlockData>;

function rawRefAttrs(data: BuilderRawRefData) {
  return {
    rawRef: data.rawRef,
    rawHash: data.rawHash,
    componentName: data.componentName,
  };
}

export const builderTextMdx: BlockMdxConfig<BuilderTextData> = {
  tag: "BuilderText",
  childrenField: "body",
  toAttrs: rawRefAttrs,
  fromAttrs: (attrs, children) => ({
    rawRef: attrs.string("rawRef") ?? "",
    rawHash: attrs.string("rawHash") ?? "",
    componentName: attrs.string("componentName"),
    body: children,
  }),
};

export const builderCodeBlockMdx: BlockMdxConfig<BuilderCodeBlockData> = {
  tag: "BuilderCodeBlock",
  toAttrs: (data) => ({
    ...rawRefAttrs(data),
    code: data.code,
    language: data.language,
    filename: data.filename,
    dark: data.dark,
    url: data.url,
  }),
  fromAttrs: (attrs) => ({
    rawRef: attrs.string("rawRef") ?? "",
    rawHash: attrs.string("rawHash") ?? "",
    componentName: attrs.string("componentName"),
    code: attrs.string("code") ?? "",
    language: attrs.string("language"),
    filename: attrs.string("filename"),
    dark: attrs.bool("dark"),
    url: attrs.string("url"),
  }),
};

export const builderCodeSnippetsV2Mdx: BlockMdxConfig<BuilderCodeSnippetsV2Data> =
  {
    tag: "BuilderCodeSnippetsV2",
    toAttrs: (data) => ({
      ...rawRefAttrs(data),
      modelName: data.modelName,
      modelType: data.modelType,
      customTabContent: data.customTabContent,
      reuseRemixContentForHydrogen: data.reuseRemixContentForHydrogen,
      convenientEditingMode: data.convenientEditingMode,
      simple: data.simple,
    }),
    fromAttrs: (attrs) => ({
      rawRef: attrs.string("rawRef") ?? "",
      rawHash: attrs.string("rawHash") ?? "",
      componentName: attrs.string("componentName"),
      modelName: attrs.string("modelName"),
      modelType: attrs.string("modelType"),
      customTabContent:
        attrs.object<Record<string, unknown>>("customTabContent"),
      reuseRemixContentForHydrogen: attrs.bool("reuseRemixContentForHydrogen"),
      convenientEditingMode: attrs.bool("convenientEditingMode"),
      simple: attrs.bool("simple"),
    }),
  };

export const builderTabbedContentMdx: BlockMdxConfig<BuilderTabbedContentData> =
  {
    tag: "BuilderTabbedContent",
    toAttrs: (data) => ({
      ...rawRefAttrs(data),
      title: data.title,
      tabs: data.tabs,
    }),
    fromAttrs: (attrs) => ({
      rawRef: attrs.string("rawRef") ?? "",
      rawHash: attrs.string("rawHash") ?? "",
      componentName: attrs.string("componentName"),
      title: attrs.string("title"),
      tabs: attrs.array<BuilderTabbedContentTab>("tabs") ?? [],
    }),
  };

export const builderSymbolMdx: BlockMdxConfig<BuilderSymbolData> = {
  tag: "BuilderSymbol",
  toAttrs: (data) => ({
    ...rawRefAttrs(data),
    entry: data.entry,
    model: data.model,
    source: data.source,
    dynamic: data.dynamic,
    data: data.data,
  }),
  fromAttrs: (attrs) => ({
    rawRef: attrs.string("rawRef") ?? "",
    rawHash: attrs.string("rawHash") ?? "",
    componentName: attrs.string("componentName"),
    entry: attrs.string("entry"),
    model: attrs.string("model"),
    source: attrs.string("source"),
    dynamic: attrs.bool("dynamic"),
    data: attrs.object<Record<string, unknown>>("data"),
  }),
};

export const builderRawBlockMdx: BlockMdxConfig<BuilderRawBlockData> = {
  tag: "BuilderRawBlock",
  toAttrs: (data) => ({
    ...rawRefAttrs(data),
    summary: data.summary,
  }),
  fromAttrs: (attrs) => ({
    rawRef: attrs.string("rawRef") ?? "",
    rawHash: attrs.string("rawHash") ?? "",
    componentName: attrs.string("componentName"),
    summary: attrs.string("summary"),
  }),
};

const ServerReadStub = () => null;

export const builderTextBlockConfig: BlockSpec<BuilderTextData> =
  defineBlock<BuilderTextData>({
    type: "builder-text",
    schema: builderTextSchema,
    mdx: builderTextMdx,
    Read: ServerReadStub,
    placement: ["block"],
    editSurface: "inline",
    label: "Builder Text",
    description:
      "Builder Text block backed by a raw sidecar so text edits preserve Builder metadata.",
  });

export const builderCodeBlockConfig: BlockSpec<BuilderCodeBlockData> =
  defineBlock<BuilderCodeBlockData>({
    type: "builder-code-block",
    schema: builderCodeBlockSchema,
    mdx: builderCodeBlockMdx,
    Read: ServerReadStub,
    placement: ["block"],
    editSurface: "panel",
    label: "Builder Code Block",
    description:
      "Builder docs/blog code block with editable code props and raw sidecar preservation.",
  });

export const builderCodeSnippetsV2BlockConfig: BlockSpec<BuilderCodeSnippetsV2Data> =
  defineBlock<BuilderCodeSnippetsV2Data>({
    type: "builder-code-snippets-v2",
    schema: builderCodeSnippetsV2Schema,
    mdx: builderCodeSnippetsV2Mdx,
    Read: ServerReadStub,
    placement: ["block"],
    editSurface: "panel",
    label: "Builder CodeSnippetsV2",
    description:
      "Builder.io docs CodeSnippetsV2 component with schema-based prop editing.",
  });

export const builderTabbedContentBlockConfig: BlockSpec<BuilderTabbedContentData> =
  defineBlock<BuilderTabbedContentData>({
    type: "builder-tabbed-content",
    schema: builderTabbedContentSchema,
    mdx: builderTabbedContentMdx,
    Read: ServerReadStub,
    placement: ["block"],
    editSurface: "panel",
    label: "Builder Tabbed Content",
    description:
      "Builder.io docs Tabbed Content component with markdown tab bodies and raw sidecar preservation.",
  });

export const builderSymbolBlockConfig: BlockSpec<BuilderSymbolData> =
  defineBlock<BuilderSymbolData>({
    type: "builder-symbol",
    schema: builderSymbolSchema,
    mdx: builderSymbolMdx,
    Read: ServerReadStub,
    placement: ["block"],
    editSurface: "panel",
    label: "Builder Symbol",
    description:
      "Builder Symbol reference. The symbol stays linked by default instead of being detached.",
  });

export const builderRawBlockConfig: BlockSpec<BuilderRawBlockData> =
  defineBlock<BuilderRawBlockData>({
    type: "builder-raw-block",
    schema: builderRawBlockSchema,
    mdx: builderRawBlockMdx,
    Read: ServerReadStub,
    placement: ["block"],
    editSurface: "none",
    label: "Builder Raw Block",
    description:
      "Unmodeled Builder block stored in a hash-checked raw JSON sidecar.",
  });

export const builderDocsBlockConfigs: BlockSpec<any>[] = [
  builderTextBlockConfig,
  builderCodeBlockConfig,
  builderCodeSnippetsV2BlockConfig,
  builderTabbedContentBlockConfig,
  builderSymbolBlockConfig,
  builderRawBlockConfig,
];

export function builderSourceKindForModel(model: string) {
  return `${BUILDER_DOCS_SOURCE_KIND_PREFIX}${model}`;
}

export function builderSourceRootPath(args: {
  entryId: string;
  sourceHash: string;
  blocksHash: string;
}) {
  return `${args.entryId}#${args.sourceHash}#${args.blocksHash}`;
}

export function parseBuilderSourceRootPath(
  sourceRootPath: string | null | undefined,
) {
  if (!sourceRootPath) return null;
  const parts = sourceRootPath.split("#");
  if (parts.length >= 3) {
    const blocksHash = parts.pop();
    const sourceHash = parts.pop();
    const entryId = parts.join("#");
    if (!entryId || !sourceHash || !blocksHash) return null;
    return { entryId, sourceHash, blocksHash };
  }
  const hashIndex = sourceRootPath.lastIndexOf("#");
  if (hashIndex <= 0 || hashIndex === sourceRootPath.length - 1) return null;
  return {
    entryId: sourceRootPath.slice(0, hashIndex),
    sourceHash: sourceRootPath.slice(hashIndex + 1),
    blocksHash: undefined,
  };
}

export function modelFromBuilderSourceKind(
  sourceKind: string | null | undefined,
) {
  if (!sourceKind?.startsWith(BUILDER_DOCS_SOURCE_KIND_PREFIX)) {
    return null;
  }
  return sourceKind.slice(BUILDER_DOCS_SOURCE_KIND_PREFIX.length) || null;
}
