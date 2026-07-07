import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  HTML_ROUGH_SELECTOR,
  isRoughOverlayMutation,
  sameRoughState,
} from "./kit";

describe("HTML wireframe rough overlay defaults", () => {
  it("sketches controls and explicit opt-ins, not broad helper containers", () => {
    expect(HTML_ROUGH_SELECTOR).toContain("[data-rough]");
    expect(HTML_ROUGH_SELECTOR).toContain("button");
    expect(HTML_ROUGH_SELECTOR).toContain("input");
    expect(HTML_ROUGH_SELECTOR).not.toContain(".wf-card");
    expect(HTML_ROUGH_SELECTOR).not.toContain(".wf-box");
    expect(HTML_ROUGH_SELECTOR).not.toContain(".wf-frame-target");
  });

  it("keeps helper container borders visible after rough.js is ready", () => {
    const css = readFileSync(
      join(process.cwd(), "app/components/plan/wireframe/html-artboard.css"),
      "utf8",
    );

    const hideRule =
      css.match(
        /\.plan-html-frame\[data-rough-ready\][^{]*\{[^}]*border-color:\s*transparent !important;[^}]*\}/s,
      )?.[0] ?? "";

    expect(hideRule).toContain("button");
    expect(hideRule).toContain('[data-rough]:not([data-rough="none"])');
    expect(hideRule).not.toContain(".wf-card");
    expect(hideRule).not.toContain(".wf-box");
  });

  it("ignores its own ready marker mutations", () => {
    expect(
      isRoughOverlayMutation({
        type: "attributes",
        attributeName: "data-rough-ready",
      } as MutationRecord),
    ).toBe(true);
  });

  it("detects unchanged rough overlay paths", () => {
    const state = {
      w: 320,
      h: 180,
      paths: [{ d: "M0 0 H10", stroke: "#111", strokeWidth: 1.4 }],
    };

    expect(sameRoughState(state, { ...state, paths: [...state.paths] })).toBe(
      true,
    );
    expect(
      sameRoughState(state, {
        ...state,
        paths: [{ ...state.paths[0], d: "M0 0 H12" }],
      }),
    ).toBe(false);
  });

  it("keeps diagram primitive text contained inside boxes", () => {
    const css = readFileSync(
      join(process.cwd(), "app/components/plan/wireframe/html-artboard.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.plan-diagram-frame\s+:is\(\s*\.diagram-panel,[^}]*\[class\*="box"\]\s*\)\s*{[^}]*overflow-wrap:\s*anywhere !important;[^}]*white-space:\s*normal !important;/s,
    );
    expect(css).toMatch(
      /\.plan-diagram-frame\s+:is\(\s*\.diagram-panel,[^}]*\)\s+:is\(h1,\s*h2,\s*h3,\s*p,\s*small,\s*strong,\s*span,\s*li\)\s*{[^}]*overflow-wrap:\s*anywhere !important;[^}]*white-space:\s*normal !important;/s,
    );
    expect(css).toMatch(
      /\.plan-diagram-frame\s+:is\(\.diagram-pill,[^}]*\)\s*{[^}]*flex-wrap:\s*wrap;[^}]*white-space:\s*normal !important;/s,
    );
  });
});
