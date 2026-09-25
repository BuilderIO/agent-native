import type { BlockMdxConfig } from "@agent-native/core/blocks";
import { z } from "zod";

/** One parameter, return type, or nested object field in a signature. */
export interface SignatureField {
  name: string;
  /** Type shown in code style, e.g. "string" or "AskUserQuestionOption[]". */
  type: string;
  optional?: boolean;
  /** Default value shown as code, e.g. "true" or '"guided-questions"'. */
  default?: string;
  description: string;
}

export interface SignatureParam extends SignatureField {
  /** Breaks an object-shaped param (e.g. an options bag) into its own fields. */
  fields?: SignatureField[];
}

export interface SignatureReturns {
  type: string;
  description?: string;
}

export interface SignatureData {
  /** The function/hook name, e.g. "askUserQuestion". */
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

/**
 * MDX config: `<Signature name params={[...]} returns={{...}} />` self-closing,
 * matching the `FileTree`/`AnnotatedCode` JSON-attribute style rather than
 * markdown children, since a signature is structured data, not prose.
 */
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
