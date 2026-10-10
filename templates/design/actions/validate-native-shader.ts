import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  MAX_EFFECT_MANIFEST_BYTES,
  parseEffectsFromHtml,
  validateEffectDocument,
} from "../shared/native-effects.js";

const MAX_DRAFT_HTML_BYTES = 4_000_000;

export default defineAction({
  description:
    "Validate a draft native v2 effect manifest or authored HTML without saving. " +
    "Checks JSON shape, property values, resource bindings, and pass graph on " +
    "the CPU. A passing result does not mean WGSL compiled or rendered on a GPU.",
  maxBodyBytes: MAX_DRAFT_HTML_BYTES + 16_384,
  schema: z
    .object({
      html: z.string().max(MAX_DRAFT_HTML_BYTES).optional(),
      document: z.unknown().optional(),
    })
    .refine(
      (args) => (args.html === undefined) !== (args.document === undefined),
      {
        message: "Provide exactly one of html or document.",
      },
    ),
  readOnly: true,
  run: async ({ html, document }) => {
    if (html !== undefined) {
      const parsed = parseEffectsFromHtml(html);
      return {
        cpuValid: parsed.errors.length === 0 && parsed.document !== null,
        manifestPresent: parsed.document !== null || parsed.errors.length > 0,
        errors: parsed.errors.length
          ? parsed.errors
          : parsed.document === null
            ? ["native effect manifest is absent"]
            : [],
        gpuCompiled: false,
      };
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(document);
    } catch {
      return {
        cpuValid: false,
        manifestPresent: true,
        errors: ["native effect document is not serializable JSON"],
        gpuCompiled: false,
      };
    }
    if (
      new TextEncoder().encode(serialized).byteLength >
      MAX_EFFECT_MANIFEST_BYTES
    ) {
      return {
        cpuValid: false,
        manifestPresent: true,
        errors: [
          `native effect manifest exceeds ${MAX_EFFECT_MANIFEST_BYTES} bytes`,
        ],
        gpuCompiled: false,
      };
    }
    const validation = validateEffectDocument(document);
    return {
      cpuValid: validation.valid,
      manifestPresent: true,
      errors: validation.errors,
      gpuCompiled: false,
    };
  },
});
