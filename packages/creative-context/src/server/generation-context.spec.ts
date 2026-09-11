import { describe, expect, it } from "vitest";

import type { CreativeContextReuseLabel } from "../types.js";
import {
  mergeCreativeContextReuseLabels,
  replaceCreativeContextElementProvenance,
  validateCreativeContextReuseLabels,
} from "./generation-context.js";

const evidence: CreativeContextReuseLabel = {
  itemId: "item-1",
  itemVersionId: "version-1",
  kind: "slide",
  label: "Metrics slide",
  dataRole: "untrusted-reference",
};

describe("validateCreativeContextReuseLabels", () => {
  it("preserves explicit per-element influence and element ids", () => {
    expect(
      validateCreativeContextReuseLabels(
        [{ ...evidence, elementId: "slide-2", influence: "adapted" }],
        { allowedEvidence: new Set(["item-1:version-1"]) },
      ),
    ).toEqual([
      {
        ...evidence,
        elementId: "slide-2",
        influence: "adapted",
      },
    ]);
  });

  it("allows generated elements to omit corpus evidence ids", () => {
    expect(
      validateCreativeContextReuseLabels(
        [
          {
            kind: "slide",
            label: "Net-new closing slide",
            dataRole: "untrusted-reference",
            elementId: "slide-8",
            influence: "generated",
          },
        ],
        { generatedOnly: true },
      ),
    ).toMatchObject([{ influence: "generated", elementId: "slide-8" }]);
  });

  it("rejects source-backed influence outside the exact pack", () => {
    expect(() =>
      validateCreativeContextReuseLabels([evidence], {
        allowedEvidence: new Set(["item-2:version-2"]),
      }),
    ).toThrow("must belong to contextPackId");
  });

  it("rejects incomplete evidence pairs and non-generated missing ids", () => {
    expect(() =>
      validateCreativeContextReuseLabels([
        { ...evidence, itemVersionId: undefined },
      ]),
    ).toThrow("both itemId and itemVersionId");
    expect(() =>
      validateCreativeContextReuseLabels([
        {
          kind: "document",
          label: "Draft",
          dataRole: "untrusted-reference",
          influence: "adapted",
        },
      ]),
    ).toThrow("Only generated element labels");
  });
});

describe("creative context provenance merging", () => {
  it("keeps prior labels while deduplicating exact evidence", () => {
    expect(
      mergeCreativeContextReuseLabels(
        [evidence],
        [evidence, { ...evidence, elementId: "slide-2" }],
      ),
    ).toEqual([evidence, { ...evidence, elementId: "slide-2" }]);
  });

  it("replaces only the provenance for regenerated elements", () => {
    expect(
      replaceCreativeContextElementProvenance(
        [
          {
            elementId: "slide-1",
            influence: "adapted",
            itemId: "item-1",
            itemVersionId: "version-1",
          },
          { elementId: "slide-2", influence: "generated" },
        ],
        [
          {
            elementId: "slide-2",
            influence: "reference-conditioned",
            itemId: "item-2",
            itemVersionId: "version-2",
          },
        ],
      ),
    ).toEqual([
      {
        elementId: "slide-1",
        influence: "adapted",
        itemId: "item-1",
        itemVersionId: "version-1",
      },
      {
        elementId: "slide-2",
        influence: "reference-conditioned",
        itemId: "item-2",
        itemVersionId: "version-2",
      },
    ]);
  });
});
