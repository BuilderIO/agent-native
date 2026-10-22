import { ActionInputValidationError } from "@agent-native/core/action";
import { describe, expect, it } from "vitest";

import { getBuiltInSlideThemeDemoSource } from "../server/lib/slide-theme-demo-sources.js";
import previewTheme from "./get-slide-theme-preview.js";

describe("rendered slide theme previews", () => {
  for (const id of ["aero", "fieldwork", "pommi"]) {
    for (const pageIndex of [0, 1, 2]) {
      it(`renders ${id} demo page ${pageIndex + 1} in the slide Worker`, async () => {
        const sourceTsx = getBuiltInSlideThemeDemoSource(id, pageIndex);
        const result = await previewTheme.run({ id, pageIndex });

        expect(sourceTsx).toBeDefined();
        expect(sourceTsx).not.toContain("document");
        expect(sourceTsx).not.toContain("fonts.googleapis.com");
        expect(sourceTsx).not.toContain("<filter");
        expect(result.pageIndex).toBe(pageIndex);
        expect(result.pageCount).toBe(3);
        expect(result.artifact).toMatchObject({
          protocolVersion: 1,
          deckId: `theme-${id}`,
          slideId: `theme-${id}-${pageIndex}`,
          revision: 1,
          width: 1920,
          height: 1080,
          html: "",
          assetOrigins: [],
          fontOrigins: [],
          fontAssets: [],
        });
        expect(result.artifact.sourceHash).toMatch(/^[a-f0-9]{64}$/);
        expect(result.artifact.runtime).toMatchObject({
          kind: "open-slide-react-worker-v1",
          page: { current: pageIndex + 1, total: 3 },
        });
        expect(result.artifact.runtime.styles.join("\n")).toContain(
          "@keyframes",
        );
        expect(result.artifact.runtime.workerSource).not.toContain(
          "fonts.googleapis.com",
        );
      });
    }
  }

  it("rejects a preview page outside the bundled theme", async () => {
    await expect(
      previewTheme.run({ id: "aero", pageIndex: 3 }),
    ).rejects.toBeInstanceOf(ActionInputValidationError);
  });
});
