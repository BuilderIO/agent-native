import { fail } from "@agent-native/core/action";
import { parse, serialize, type DefaultTreeAdapterTypes } from "parse5";
import { z } from "zod";

import { parseHubLInterpolation } from "./hubl-interpolation.js";

export const sampleContactValuesSchema = z
  .array(
    z.object({
      field: z.string().regex(/^contact\.\w+(?:\.\w+)*$/),
      value: z.string().max(500),
    }),
  )
  .max(8)
  .refine(
    (values) =>
      new Set(values.map(({ field }) => field)).size === values.length,
    "Sample contact fields must be unique.",
  );

export type SampleContactValues = z.infer<typeof sampleContactValuesSchema>;

const SAMPLE_VALUES: Record<string, string> = {
  "site_settings.company_name": "Example Company",
  "site_settings.company_street_address_1": "123 Example Street",
  "site_settings.company_city": "Example City",
  "site_settings.company_state": "EX",
  unsubscribe_link: "https://example.invalid/preferences",
  unsubscribe_link_all: "https://example.invalid/unsubscribe-all",
  unsubscribe_link_single: "https://example.invalid/unsubscribe",
  view_as_page_url: "https://example.invalid/email-preview",
  subscription_confirmation_url: "https://example.invalid/confirmation",
  "content.absolute_url": "https://example.invalid/email-preview",
};
function previewValue(
  token: string,
  samples: Record<string, string>,
  used: Set<string>,
): string | undefined {
  const parsed = parseHubLInterpolation(token);
  if (!parsed) return undefined;
  if (Object.prototype.hasOwnProperty.call(SAMPLE_VALUES, parsed.name))
    return SAMPLE_VALUES[parsed.name];
  if (!/^contact\.[\w.]+$/.test(parsed.name)) return undefined;
  if (
    parsed.personalization &&
    !parsed.filtered &&
    Object.prototype.hasOwnProperty.call(samples, parsed.name)
  ) {
    used.add(parsed.name);
    return samples[parsed.name];
  }
  return parsed.fallback;
}

export function createHubSpotEmailPreview(
  source: string,
  sampleContactValues?: SampleContactValues,
): {
  html: string;
  preview: {
    mode: "hubspot-email";
    sampleValues: true;
    substitutedTokens: string[];
    unresolvedTokens: string[];
    usedContactFields?: string[];
  };
} {
  const validated = sampleContactValuesSchema.safeParse(
    sampleContactValues ?? [],
  );
  if (!validated.success)
    fail(
      "Recipient samples require at most 8 unique {field, value} entries with contact.field names and string values of at most 500 characters.",
      { errorCode: "invalid_hubspot_preview_samples", statusCode: 422 },
    );
  const usedContactFields = new Set<string>();
  const samples = Object.fromEntries(
    validated.data.map(({ field, value }) => [field, value]),
  );
  let prefix = "ANEMAILPREVIEW";
  while (source.includes(prefix)) prefix += "_";
  const tokens: string[] = [];
  const protectedHtml = source.replace(
    /{{[\s\S]*?}}|{%[\s\S]*?%}/g,
    (token) => {
      tokens.push(token);
      return `${prefix}${tokens.length - 1}TOKEN`;
    },
  );
  const substitutedTokens = new Set<string>();
  const unresolvedTokens = new Set<string>();
  const restore = (value: string, substitute: boolean): string =>
    value.replace(
      new RegExp(`${prefix}(\\d+)TOKEN`, "g"),
      (_, index: string) => {
        const token = tokens[Number(index)];
        const sample = substitute
          ? previewValue(token, samples, usedContactFields)
          : undefined;
        if (sample === undefined) {
          unresolvedTokens.add(token);
          return token;
        }
        substitutedTokens.add(token);
        return sample;
      },
    );
  const document = parse(protectedHtml);
  const visit = (
    node: DefaultTreeAdapterTypes.Node,
    substitute = true,
  ): void => {
    if ("tagName" in node) {
      substitute = substitute && !["script", "style"].includes(node.tagName);
      for (const attr of node.attrs)
        attr.value = restore(attr.value, substitute);
    }
    if (node.nodeName === "#text") {
      const text = node as DefaultTreeAdapterTypes.TextNode;
      text.value = restore(text.value, substitute);
    }
    if (node.nodeName === "#comment") {
      const comment = node as DefaultTreeAdapterTypes.CommentNode;
      comment.data = restore(comment.data, false);
    }
    if ("childNodes" in node)
      for (const child of node.childNodes) visit(child, substitute);
    if ("tagName" in node && node.tagName === "template")
      visit((node as DefaultTreeAdapterTypes.Template).content, substitute);
  };
  visit(document);
  const unused = Object.keys(samples).filter(
    (field) => !usedContactFields.has(field),
  );
  if (unused.length)
    fail(
      `Recipient sample fields have no supported personalization_token interpolation in rendered text or attributes: ${unused.join(", ")}.`,
      { errorCode: "invalid_hubspot_preview_samples", statusCode: 422 },
    );
  return {
    html: serialize(document),
    preview: {
      mode: "hubspot-email",
      sampleValues: true,
      substitutedTokens: [...substitutedTokens],
      unresolvedTokens: [...unresolvedTokens],
      ...(sampleContactValues === undefined
        ? {}
        : { usedContactFields: [...usedContactFields] }),
    },
  };
}
