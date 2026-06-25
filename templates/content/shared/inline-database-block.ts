import {
  defineBlock,
  type BlockMdxConfig,
  type BlockSpec,
} from "@agent-native/core/blocks/server";
import { z } from "zod";

export interface InlineDatabaseData {
  databaseId: string;
  databaseDocumentId: string;
  ownerBlockId: string;
}

export const inlineDatabaseSchema = z.object({
  databaseId: z.string().trim().min(1),
  databaseDocumentId: z.string().trim().min(1),
  ownerBlockId: z.string().trim().min(1),
}) as unknown as z.ZodType<InlineDatabaseData>;

export const inlineDatabaseMdx: BlockMdxConfig<InlineDatabaseData> = {
  tag: "InlineDatabase",
  toAttrs: (data) => ({
    databaseId: data.databaseId,
    databaseDocumentId: data.databaseDocumentId,
    ownerBlockId: data.ownerBlockId,
  }),
  fromAttrs: (attrs) => ({
    databaseId: attrs.string("databaseId") ?? "",
    databaseDocumentId: attrs.string("databaseDocumentId") ?? "",
    ownerBlockId: attrs.string("ownerBlockId") ?? "",
  }),
};

const ServerReadStub = () => null;

export const inlineDatabaseBlockConfig: BlockSpec<InlineDatabaseData> =
  defineBlock<InlineDatabaseData>({
    type: "inline-database",
    schema: inlineDatabaseSchema,
    mdx: inlineDatabaseMdx,
    Read: ServerReadStub,
    placement: ["block"],
    label: "Database",
    description:
      "A live inline database reference embedded in a page body. Stores ids only; the database rows stay in the referenced database document.",
  });
