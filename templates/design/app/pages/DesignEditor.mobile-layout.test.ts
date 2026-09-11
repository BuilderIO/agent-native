import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Design editor mobile layout", () => {
  const editorSource = readFileSync("app/pages/DesignEditor.tsx", "utf8");
  const layoutSource = readFileSync("app/components/layout/Layout.tsx", "utf8");
  const bottomToolbarSource = readFileSync(
    "app/components/design/editor/DesignBottomToolbar.tsx",
    "utf8",
  );
  const workspaceRailSource = readFileSync(
    "app/components/design/editor/DesignWorkspaceRail.tsx",
    "utf8",
  );

  it("uses the dynamic viewport height for the app shell", () => {
    expect(layoutSource).toContain(
      "agent-layout-shell flex h-dvh w-full overflow-hidden",
    );
    expect(layoutSource).not.toContain(
      "agent-layout-shell flex h-screen w-full overflow-hidden",
    );
  });

  it("keeps wide rails out while preserving mobile editor controls", () => {
    expect(bottomToolbarSource).toContain(
      "flex max-w-[calc(100%-1rem)] -translate-x-1/2",
    );
    expect(bottomToolbarSource).toContain("overflow-x-auto rounded-xl");
    // Sidebars overlay the full-bleed canvas so opening/closing chrome does
    // not reflow pan/centering. Absolute left/right shells are required.
    expect(editorSource).toContain(
      "absolute inset-y-0 left-0 z-[70] flex min-h-0",
    );
    // Right inspector classnames live in minimal-inspector.ts so minimal mode
    // can swap the docked rail for a floating card without duplicating shells.
    expect(editorSource).toContain(
      "className={rightInspectorPanelClassName(minimalUi)}",
    );
    const inspectorSource = readFileSync(
      "app/pages/design-editor/minimal-inspector.ts",
      "utf8",
    );
    expect(inspectorSource).toContain(
      "absolute inset-y-0 right-0 z-[70] hidden h-full min-h-0 flex-col",
    );
    expect(inspectorSource).toContain(
      "absolute top-14 right-3 bottom-3 z-[70] hidden min-h-0 flex-col overflow-hidden rounded-2xl",
    );
    expect(editorSource).toContain(
      "max-w-[calc(100dvw-var(--design-chrome-rail-width))] shrink-0 flex-col",
    );
    expect(editorSource).toContain('aria-label={t("editPanel.properties")}');
    expect(editorSource).toContain(
      'className="w-[min(92vw,360px)] overflow-hidden p-0 md:hidden"',
    );
  });

  it("keeps the app shell in non-Builder embedded routes", () => {
    expect(layoutSource).toContain(
      'type DesignLayoutMode = "host-bare" | "standalone-editor" | "app-shell";',
    );
    expect(layoutSource).toContain('if (layoutMode === "host-bare")');
    expect(layoutSource).toContain('if (layoutMode === "standalone-editor")');
    expect(layoutSource).toContain(
      "!embedded && EDITOR_PREFIXES.some((p) => location.pathname.startsWith(p))",
    );
    expect(layoutSource).toContain("input.embedChromeRequested");
    expect(layoutSource).toContain("{!standaloneEditor && (\n");
  });

  it("keeps the standard rails in the visual-edit embed", () => {
    expect(editorSource).toContain(
      "embedded && !hostOwnsChrome && !embedChromeRequested",
    );
  });

  it("lets the compact workspace rail scroll on short screens", () => {
    expect(workspaceRailSource).toContain(
      "items-center overflow-y-auto overscroll-contain",
    );
  });
});
