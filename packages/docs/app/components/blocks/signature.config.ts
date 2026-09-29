import type { BlockMdxConfig } from "@agent-native/core/blocks";
import { z } from "zod";

export interface SignatureField {
  name: string;
  type: string;
  optional?: boolean;
  default?: string;
  description: string;
}

export interface SignatureParam extends SignatureField {
  fields?: SignatureField[];
}

export interface SignatureReturns {
  type: string;
  description?: string;
}

export interface SignatureData {
  name: string;
  params: SignatureParam[];
  returns?: SignatureReturns;
}

const fieldSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.string().trim().min(1).max(200),
  optional: z.boolean().optional(),
  default: z.string().trim().max(200).optional(),
  description: z.string().trim().min(1).max(2_000),
}) as z.ZodType<SignatureField>;

const paramSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.string().trim().min(1).max(200),
  optional: z.boolean().optional(),
  default: z.string().trim().max(200).optional(),
  description: z.string().trim().min(1).max(2_000),
  fields: z.array(fieldSchema).max(40).optional(),
}) as unknown as z.ZodType<SignatureParam>;

export const signatureSchema = z.object({
  name: z.string().trim().min(1).max(120),
  params: z.array(paramSchema).max(20),
  returns: z
    .object({
      type: z.string().trim().min(1).max(200),
      description: z.string().trim().max(2_000).optional(),
    })
    .optional(),
}) as unknown as z.ZodType<SignatureData>;

export const signatureMdx: BlockMdxConfig<SignatureData> = {
  tag: "Signature",
  toAttrs: (data) => ({
    name: data.name,
    params: data.params,
    returns: data.returns as Record<string, unknown> | undefined,
  }),
  fromAttrs: (attrs) => ({
    name: attrs.string("name") ?? "",
    params: attrs.array<SignatureParam>("params") ?? [],
    returns: attrs.object<SignatureReturns>("returns"),
  }),
};
