import { describe, expect, it } from "vitest";

import {
  DESIGN_GENERATION_ATTEMPT_QUERY_PARAM,
  getDesignGenerationPageviewProvenance,
  isDesignGenerationAttemptId,
} from "./generation-provenance.js";

describe("Design generation pageview provenance", () => {
  it("attaches the exact output and generation attempt from an opened result link", () => {
    expect(
      getDesignGenerationPageviewProvenance(
        "/design/design-1",
        `?screen=file-1&${DESIGN_GENERATION_ATTEMPT_QUERY_PARAM}=attempt_1234567890abcdef`,
      ),
    ).toEqual({
      kind: "design-output",
      properties: {
        output_id: "design-1",
        generation_attempt_id: "attempt_1234567890abcdef",
      },
    });
  });

  it("keeps output identity for ordinary editor visits without inventing an attempt", () => {
    expect(
      getDesignGenerationPageviewProvenance("/design/design-1", ""),
    ).toEqual({
      kind: "design-output",
      properties: { output_id: "design-1" },
    });
  });

  it("ignores malformed or ambiguous attempt identifiers", () => {
    expect(isDesignGenerationAttemptId("short")).toBe(false);
    expect(
      getDesignGenerationPageviewProvenance(
        "/design/design-1",
        `?${DESIGN_GENERATION_ATTEMPT_QUERY_PARAM}=attempt_1234567890abcdef&${DESIGN_GENERATION_ATTEMPT_QUERY_PARAM}=attempt_2234567890abcdef`,
      ),
    ).toEqual({
      kind: "design-output",
      properties: { output_id: "design-1" },
    });
  });

  it("does not attach Design output identifiers on other routes", () => {
    expect(
      getDesignGenerationPageviewProvenance(
        "/home",
        `?${DESIGN_GENERATION_ATTEMPT_QUERY_PARAM}=attempt_1234567890abcdef`,
      ),
    ).toEqual({ kind: "other-route" });
  });

  it("distinguishes malformed route encoding from a page without Design provenance", () => {
    expect(getDesignGenerationPageviewProvenance("/design/%E0%80", "")).toEqual(
      { kind: "invalid-route" },
    );
  });
});
