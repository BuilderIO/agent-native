import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Design editor mobile layout", () => {
  const editorSource = readFileSync("app/pages/DesignEditor.tsx", "utf8");
  const layoutSource = readFileSync("app/components/layout/Layout.tsx", "utf8");

  it("uses the dynamic viewport height for the app shell", () => {
    expect(layoutSource).toContain(
      "agent-layout-shell flex h-dvh w-full overflow-hidden",
    );
    expect(layoutSource).not.toContain(
      "agent-layout-shell flex h-screen w-full overflow-hidden",
    );
  });

  it("keeps wide rails out while preserving mobile editor controls", () => {
    expect(editorSource).toContain(
      "flex max-w-[calc(100%-1rem)] -translate-x-1/2",
    );
    expect(editorSource).toContain("overflow-x-auto rounded-xl");
    expect(editorSource).toContain(
      "relative hidden h-full min-h-0 shrink-0 flex-col",
    );
    expect(editorSource).toContain(
      "max-w-[calc(100dvw-57px)] shrink-0 flex-col",
    );
    expect(editorSource).toContain('aria-label={t("editPanel.properties")}');
    expect(editorSource).toContain(
      'className="w-[min(92vw,360px)] overflow-hidden p-0 md:hidden"',
    );
  });

  it("lets the compact workspace rail scroll on short screens", () => {
    expect(editorSource).toContain(
      "items-center overflow-y-auto overscroll-contain",
    );
  });
});
