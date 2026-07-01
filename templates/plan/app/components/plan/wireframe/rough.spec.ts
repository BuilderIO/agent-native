import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HTML_ROUGH_SELECTOR } from "./kit";

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
