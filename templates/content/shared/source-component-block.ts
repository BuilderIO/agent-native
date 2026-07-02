import {
  defineBlock,
  type BlockMdxConfig,
  type BlockSpec,
} from "@agent-native/core/blocks/server";
import { z } from "zod";

export interface SourceComponentData {
  provider: string;
  componentName: string;
  rawRef: string;
  rawHash: string;
  sourceLabel?: string;
  previewStatus?: "available" | "unavailable" | "warning";
  previewKind?: "summary" | "table" | "embed" | "symbol" | "component";
  previewUrl?: string;
  previewItems?: string[];
  preview?: SourceComponentPreview;
  title?: string;
  summary?: string;
}

export interface SourceComponentPreview {
  status: "available" | "unavailable" | "warning";
  kind: "summary" | "table" | "embed" | "symbol" | "component";
  label: string;
  summary?: string;
  fields?: SourceComponentPreviewField[];
  table?: SourceComponentPreviewTable;
  url?: string;
}

export interface SourceComponentPreviewField {
  label: string;
  value: string;
}

export interface SourceComponentPreviewTable {
  columns: SourceComponentPreviewTableColumn[];
  rows: Record<string, string>[];
  truncated?: boolean;
}

export interface SourceComponentPreviewTableColumn {
  id: string;
  label: string;
}

const sourceComponentPreviewFieldSchema = z.object({
  label: z.string().trim().min(1).max(80),
  value: z.string().trim().max(200),
});

const sourceComponentPreviewTableColumnSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
});

const sourceComponentPreviewTableSchema = z.object({
  columns: z.array(sourceComponentPreviewTableColumnSchema).max(12),
  rows: z.array(z.record(z.string(), z.string().max(500))).max(6),
  truncated: z.boolean().optional(),
});

const sourceComponentPreviewSchema = z.object({
  status: z.enum(["available", "unavailable", "warning"]),
  kind: z.enum(["summary", "table", "embed", "symbol", "component"]),
  label: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(500).optional(),
  fields: z.array(sourceComponentPreviewFieldSchema).max(8).optional(),
  table: sourceComponentPreviewTableSchema.optional(),
  url: z.string().trim().max(2_000).optional(),
}) satisfies z.ZodType<SourceComponentPreview>;

export const sourceComponentSchema = z.object({
  provider: z.string().trim().min(1).max(80),
  componentName: z.string().trim().min(1).max(160),
  rawRef: z.string().trim().min(1),
  rawHash: z.string().trim().min(1),
  sourceLabel: z.string().trim().max(200).optional(),
  previewStatus: z.enum(["available", "unavailable", "warning"]).optional(),
  previewKind: z
    .enum(["summary", "table", "embed", "symbol", "component"])
    .optional(),
  previewUrl: z.string().trim().max(2_000).optional(),
  previewItems: z.array(z.string().trim().max(160)).max(8).optional(),
  preview: sourceComponentPreviewSchema.optional(),
  title: z.string().trim().max(200).optional(),
  summary: z.string().trim().max(500).optional(),
}) as unknown as z.ZodType<SourceComponentData>;

export const sourceComponentMdx: BlockMdxConfig<SourceComponentData> = {
  tag: "SourceComponent",
  toAttrs: (data) => ({
    provider: data.provider,
    componentName: data.componentName,
    rawRef: data.rawRef,
    rawHash: data.rawHash,
    sourceLabel: data.sourceLabel,
    previewStatus: data.previewStatus,
    previewKind: data.previewKind,
    previewUrl: data.previewUrl,
    previewItems: data.previewItems,
    preview: data.preview as Record<string, unknown> | undefined,
    previewTitle: data.title,
    summary: data.summary,
  }),
  fromAttrs: (attrs) => ({
    provider: attrs.string("provider") ?? "",
    componentName: attrs.string("componentName") ?? "",
    rawRef: attrs.string("rawRef") ?? "",
    rawHash: attrs.string("rawHash") ?? "",
    sourceLabel: attrs.string("sourceLabel"),
    previewStatus: attrs.string("previewStatus") as
      | SourceComponentData["previewStatus"]
      | undefined,
    previewKind: attrs.string("previewKind") as
      | SourceComponentData["previewKind"]
      | undefined,
    previewUrl: attrs.string("previewUrl"),
    previewItems: attrs.array<string>("previewItems"),
    preview: attrs.object<SourceComponentPreview>("preview"),
    title: attrs.string("previewTitle") ?? attrs.string("title"),
    summary: attrs.string("summary"),
  }),
};

const ServerReadStub = () => null;

export const sourceComponentBlockConfig: BlockSpec<SourceComponentData> =
  defineBlock<SourceComponentData>({
    type: "source-component",
    schema: sourceComponentSchema,
    mdx: sourceComponentMdx,
    Read: ServerReadStub,
    placement: ["block"],
    editSurface: "none",
    label: "Source component",
    description:
      "A read-only source-native component marker that preserves provider-specific body blocks for round-trip sync.",
  });
