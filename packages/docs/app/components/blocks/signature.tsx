import { defineBlock } from "@agent-native/core/blocks";
import type {
  BlockReadProps,
  BlockRenderContext,
} from "@agent-native/core/blocks";
import { IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";

import {
  signatureSchema,
  signatureMdx,
  type SignatureData,
  type SignatureField,
} from "./signature.config";

export type { SignatureData };

function paramSignatureText(param: SignatureField): string {
  return `${param.name}${param.optional ? "?" : ""}: ${param.type}`;
}

function FieldRow({
  field,
  ctx,
}: {
  field: SignatureField;
  ctx: BlockRenderContext;
}) {
  return (
    <div className="docs-sig-field">
      <div className="docs-sig-field-head">
        <span className="docs-sig-field-name">{field.name}</span>
        <span className="docs-sig-field-type">{field.type}</span>
        {field.optional && <span className="docs-sig-field-tag">optional</span>}
        {field.default && (
          <span className="docs-sig-field-tag">default {field.default}</span>
        )}
      </div>
      {ctx.renderMarkdown?.(field.description) ?? (
        <p className="docs-sig-field-desc">{field.description}</p>
      )}
    </div>
  );
}

/**
 * Read-only renderer for a `signature` block. Collapsed by default to just the
 * code-style call line; clicking it reveals the parameter/return breakdown. The
 * generic block `title` (falling back to "Signature") renders as a faded label
 * above the whole thing, separate from the clickable header inside it.
 */
export function SignatureBlock({
  data,
  title,
  ctx,
}: BlockReadProps<SignatureData>) {
  const [open, setOpen] = useState(false);
  const signatureLine = `${data.name}(${data.params
    .map(paramSignatureText)
    .join(", ")})${data.returns ? `: ${data.returns.type}` : ""}`;

  return (
    <div className="docs-sig-wrap">
      <p className="docs-sig-title">{title || "Signature"}</p>
      <section className="docs-signature">
        <button
          type="button"
          className="docs-sig-line"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <IconChevronRight className="docs-sig-chevron" aria-hidden="true" />
          <code className="docs-sig-code">{signatureLine}</code>
        </button>

        {open && (
          <>
            {data.params.length > 0 && (
              <div className="docs-sig-section">
                <p className="docs-sig-section-label">Parameters</p>
                <div className="docs-sig-params">
                  {data.params.map((param, i) => (
                    <div key={i} className="docs-sig-param">
                      <FieldRow field={param} ctx={ctx} />
                      {param.fields && param.fields.length > 0 && (
                        <div className="docs-sig-nested-fields">
                          {param.fields.map((field, j) => (
                            <FieldRow key={j} field={field} ctx={ctx} />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.returns && (
              <div className="docs-sig-section">
                <p className="docs-sig-section-label">Returns</p>
                <div className="docs-sig-returns">
                  <span className="docs-sig-field-type">
                    {data.returns.type}
                  </span>
                  {data.returns.description &&
                    (ctx.renderMarkdown?.(data.returns.description) ?? (
                      <p className="docs-sig-field-desc">
                        {data.returns.description}
                      </p>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export const signatureBlock = defineBlock<SignatureData>({
  type: "signature",
  schema: signatureSchema,
  mdx: signatureMdx,
  Read: SignatureBlock,
  placement: ["block"],
  label: "Signature",
  description:
    "A function/hook signature reference: a code-style call line plus a parameter and return-type breakdown.",
  empty: () => ({
    name: "myFunction",
    params: [
      {
        name: "input",
        type: "string",
        description: "Describe the parameter.",
      },
    ],
    returns: { type: "void" },
  }),
});
