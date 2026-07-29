/**
 * P0 SILENT DATA LOSS — deep-linking or refreshing a localhost screen in
 * SINGLE view replaced the running app with the literal text
 * "http://localhost:8210/", and the Layers panel then reported "No layers"
 * with no error anywhere.
 *
 * A localhost screen's `design_files.content` IS its route URL. Every host
 * path that treats stored/collab content as a document — the collab seed, the
 * SQL reconcile passes, undo/redo replay — funnels into `replacePreviewContent`,
 * which posts it to the bridge as a whole-document replace. The design-state
 * "clear state" restore is the one host push that bypasses that callback.
 *
 * These pin both refusals. Source-level assertions because the guards live in
 * closures inside DesignEditor.tsx (same approach as
 * runtime-layer-state-handoff.spec.ts).
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isStandaloneHttpUrl } from "./editor-state";

const editorSource = readFileSync(
  new URL("../DesignEditor.tsx", import.meta.url),
  "utf8",
);

function sourceSection(start: string, end: string): string {
  const startIndex = editorSource.indexOf(start);
  const endIndex = editorSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return editorSource.slice(startIndex, endIndex);
}

describe("live screen URL preview guard", () => {
  it("treats a localhost screen's stored content as a URL, not a document", () => {
    expect(isStandaloneHttpUrl("http://localhost:8210/")).toBe(true);
    expect(isStandaloneHttpUrl("<html><body>real</body></html>")).toBe(false);
  });

  it("skips a route URL without treating the intentional refusal as a render failure", () => {
    const section = sourceSection(
      "const replacePreviewContent = useCallback(",
      "const syncLiveScreenSnapshotPreview",
    );
    const guard = "if (isStandaloneHttpUrl(nextContent))";
    const bridgeLookup = "(window as any).__designCanvasReplaceContent";

    expect(section).toContain(guard);
    // Refusing must happen before the bridge handle is even resolved, and must
    // report "not replaced" so no caller mistakes it for an applied update.
    expect(section.indexOf(guard)).toBeLessThan(section.indexOf(bridgeLookup));
    expect(section).toMatch(
      /if \(isStandaloneHttpUrl\(nextContent\)\) \{[\s\S]*?return "skipped-live-route";\s*\}/,
    );
    expect(section).not.toMatch(
      /if \(isStandaloneHttpUrl\(nextContent\)\) \{[\s\S]*?console\.error\(/,
    );

    const fallback = sourceSection(
      "export function previewContentReplaceNeedsRenderFallback",
      "const OVERVIEW_ZOOM_THRESHOLD",
    );
    expect(fallback).toContain('return result === "unavailable"');
    expect(fallback).not.toContain("skipped-live-route");
    expect(editorSource).not.toContain("!replacePreviewContent(");
  });

  it("refuses design-state preview and restore on a live screen", () => {
    const section = sourceSection(
      "const handleDesignStateSelect = useCallback(",
      "// ── Inspector header quick actions",
    );
    const guard = "if (isStandaloneHttpUrl(activeContent))";

    expect(section).toContain(guard);
    // The guard covers BOTH branches: entering a state preview clobbers the
    // running app, and the stateId === null restore posts the route URL.
    // Refusing only the restore would leave the app unrecoverable.
    expect(section.indexOf(guard)).toBeLessThan(
      section.indexOf("if (stateId === null)"),
    );
    expect(section).toMatch(
      /if \(isStandaloneHttpUrl\(activeContent\)\) \{[\s\S]*?designStateLiveScreen[\s\S]*?return;\s*\}/,
    );
  });
});
