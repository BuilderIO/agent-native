import { describe, expect, it } from "vitest";

import {
  buildContrastAuditRequest,
  finalizeContrastAudit,
  type ContrastAuditBrowserResult,
  type ContrastFailure,
} from "./contrast-audit";

const request = buildContrastAuditRequest("deck-1", {
  designSystemId: "ds-1",
  slides: [
    { id: "a", content: "<p>A</p>" },
    { id: "b", content: "<p>B</p>" },
  ],
});

const failure: ContrastFailure = {
  slideId: "b",
  text: "Muted caption",
  foreground: "#aaaaaa",
  background: "#ffffff",
  ratio: 2.32,
  requiredRatio: 4.5,
  fontSize: "12.0pt (16px)",
  fontWeight: "normal",
};

function browserResult(
  overrides: Partial<ContrastAuditBrowserResult> = {},
): ContrastAuditBrowserResult {
  return {
    deckId: "deck-1",
    renderKey: request.renderKey,
    audited: request.slides.map((slide) => ({
      id: slide.id,
      contentHash: slide.contentHash,
    })),
    failures: [],
    unverified: [],
    skipped: [],
    ...overrides,
  };
}

describe("finalizeContrastAudit", () => {
  it("claims a pass only when every slide was audited with no findings", () => {
    expect(
      finalizeContrastAudit(request, browserResult()).canClaimContrastPasses,
    ).toBe(true);
    expect(
      finalizeContrastAudit(
        request,
        browserResult({
          unverified: [{ slideId: "a", text: "Hero", reason: "bgImage" }],
        }),
      ).canClaimContrastPasses,
    ).toBe(false);
  });

  it("treats a slide the browser never reported as missing, not clean", () => {
    const report = finalizeContrastAudit(
      request,
      browserResult({
        audited: [{ id: "a", contentHash: request.slides[0].contentHash }],
      }),
    );
    expect(report.skipped).toEqual([
      { slideId: "b", reason: "missing-from-result", slideNumber: 2 },
    ]);
    expect(report.canClaimContrastPasses).toBe(false);
  });

  it("drops findings for a slide audited at an older version", () => {
    const report = finalizeContrastAudit(
      request,
      browserResult({
        audited: [
          { id: "a", contentHash: request.slides[0].contentHash },
          { id: "b", contentHash: "stale" },
        ],
        failures: [failure],
      }),
    );
    expect(report.failures).toEqual([]);
    expect(report.skipped).toEqual([
      { slideId: "b", reason: "stale-render", slideNumber: 2 },
    ]);
  });

  it("rejects a malformed result instead of reading it as empty", () => {
    expect(() => finalizeContrastAudit(request, { deckId: "deck-1" })).toThrow(
      "malformed",
    );
  });

  it("rejects a finding for a slide outside the request instead of dropping it", () => {
    expect(() =>
      finalizeContrastAudit(
        request,
        browserResult({
          failures: [{ ...failure, slideId: "unknown-slide" }],
        }),
      ),
    ).toThrow("unknown slide");
  });
});
